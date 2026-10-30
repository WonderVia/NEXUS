import { attemptsAPI } from './api';
import { OfflineAssessmentPackage } from '../types';

export interface OfflineSyncState {
  isOnline: boolean;
  syncStatus: 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';
  pendingCount: number;
  lastSyncAt: string | null;
  errorMessage: string | null;
  isOfflineCapable: boolean;
  submissionState: 'not_submitted' | 'pending_sync' | 'submitted' | 'failed';
}

type SyncStateListener = (state: OfflineSyncState) => void;

class OfflineSyncManager {
  private attemptId: string | null = null;
  private isOfflineCapable = false;
  private listeners: Set<SyncStateListener> = new Set();
  private syncTimer: any = null;
  private backoffDelayMs = 2000;
  private maxBackoffDelayMs = 30000;
  private isSyncing = false;
  private cleanupElectronListener: (() => void) | null = null;

  private state: OfflineSyncState = {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncStatus: 'synced',
    pendingCount: 0,
    lastSyncAt: null,
    errorMessage: null,
    isOfflineCapable: false,
    submissionState: 'not_submitted'
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);

      // Listen to Electron connectivity changes if available
      if (window.electronAPI?.offline?.onConnectivityChanged) {
        this.cleanupElectronListener = window.electronAPI.offline.onConnectivityChanged((data) => {
          this.setOnline(data.online);
        });
      }
    }
  }

  private updateState(partial: Partial<OfflineSyncState>) {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('[OfflineSyncManager] Listener error:', err);
      }
    }
  }

  public subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public getState(): OfflineSyncState {
    return { ...this.state };
  }

  private handleOnline = () => {
    console.log('[OfflineSyncManager] Network online event detected');
    this.setOnline(true);
  };

  private handleOffline = () => {
    console.log('[OfflineSyncManager] Network offline event detected');
    this.setOnline(false);
  };

  public setOnline(online: boolean) {
    if (this.state.isOnline !== online) {
      this.updateState({
        isOnline: online,
        syncStatus: online ? (this.state.pendingCount > 0 ? 'pending' : 'synced') : 'pending'
      });

      if (online) {
        this.backoffDelayMs = 2000;
        this.scheduleSync(500);
      }
    }
  }

  public async start(attemptId: string, isOfflineCapable: boolean, pkg?: OfflineAssessmentPackage) {
    this.attemptId = attemptId;
    this.isOfflineCapable = isOfflineCapable;
    this.updateState({ isOfflineCapable });

    // Cache package in Electron offline store if available
    if (isOfflineCapable && pkg && window.electronAPI?.offline?.cacheAssessmentPackage) {
      try {
        await window.electronAPI.offline.cacheAssessmentPackage(pkg);
        console.log('[OfflineSyncManager] Cached assessment package locally in Electron store');
      } catch (err) {
        console.warn('[OfflineSyncManager] Failed to cache assessment package locally:', err);
      }
    }

    // Refresh pending count
    await this.refreshPendingCount();

    // Check if there was a previous pending submission
    if (window.electronAPI?.offline?.getSubmissionState) {
      try {
        const sub = await window.electronAPI.offline.getSubmissionState(attemptId);
        if (sub && sub.state) {
          this.updateState({ submissionState: sub.state as any });
        }
      } catch (err) {
        console.error('[OfflineSyncManager] Error checking submission state:', err);
      }
    }

    // Initial sync trigger
    if (this.state.isOnline) {
      this.scheduleSync(1000);
    }
  }

  public stop() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.attemptId = null;
  }

  public async refreshPendingCount(): Promise<number> {
    if (!this.attemptId) return 0;
    try {
      if (window.electronAPI?.offline?.getPendingSyncPayload) {
        const payload = await window.electronAPI.offline.getPendingSyncPayload(this.attemptId);
        if (payload) {
          const totalPending =
            (payload.answers?.length || 0) +
            (payload.answerChanges?.length || 0) +
            (payload.proctoringEvents?.length || 0);
          this.updateState({
            pendingCount: totalPending,
            syncStatus: totalPending > 0 ? (this.state.syncStatus === 'syncing' ? 'syncing' : 'pending') : 'synced'
          });
          return totalPending;
        }
      }
    } catch (err) {
      console.warn('[OfflineSyncManager] Could not refresh pending count:', err);
    }
    return 0;
  }

  public scheduleSync(delayMs = 0) {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = setTimeout(() => {
      this.syncNow();
    }, delayMs);
  }

  public async saveAnswerDurable(
    questionId: string,
    selectedOption: number,
    previousOption?: number,
    reason = 'candidate_selection'
  ): Promise<{ ok: boolean; localSeq?: number }> {
    if (!this.attemptId) return { ok: false };
    const nowIso = new Date().toISOString();

    // 1. Durably save into Electron offline store first
    let localSeq: number | undefined;
    if (window.electronAPI?.offline?.saveAnswer) {
      try {
        const res = await window.electronAPI.offline.saveAnswer({
          attemptId: this.attemptId,
          questionId,
          selectedOption,
          clientAnsweredAt: nowIso,
          previousOption,
          reason
        });
        if (res.ok) {
          localSeq = res.localSeq;
        }
      } catch (err) {
        console.error('[OfflineSyncManager] Failed saving answer to local SQLite store:', err);
      }
    }

    // 2. Refresh pending count and schedule sync
    await this.refreshPendingCount();

    // 3. If online, trigger rapid background sync
    if (this.state.isOnline) {
      this.scheduleSync(300);
    }

    return { ok: true, localSeq };
  }

  public async logProctoringEventDurable(event: {
    eventType: string;
    severity?: string;
    details?: string;
    detectionSource?: string;
    timestamp?: string;
  }): Promise<{ ok: boolean; eventId?: string }> {
    if (!this.attemptId) return { ok: false };

    let eventId: string | undefined;
    if (window.electronAPI?.offline?.logProctoringEvent) {
      try {
        const res = await window.electronAPI.offline.logProctoringEvent({
          attemptId: this.attemptId,
          ...event
        });
        if (res.ok) {
          eventId = res.eventId;
        }
      } catch (err) {
        console.error('[OfflineSyncManager] Failed logging proctoring event to local store:', err);
      }
    }

    await this.refreshPendingCount();
    if (this.state.isOnline) {
      this.scheduleSync(500);
    }

    return { ok: true, eventId };
  }

  public async logNavigationDurable(fromQuestionIndex: number, toQuestionIndex: number, direction?: string) {
    if (!this.attemptId) return;
    if (window.electronAPI?.offline?.logNavigationEvent) {
      try {
        await window.electronAPI.offline.logNavigationEvent({
          attemptId: this.attemptId,
          fromQuestionIndex,
          toQuestionIndex,
          direction
        });
      } catch {
        // Navigation logs are best-effort
      }
    }
  }

  public async submitDurable(autoSubmitted = false, reason = 'candidate_action'): Promise<{
    success: boolean;
    synced: boolean;
    message: string;
    result?: any;
  }> {
    if (!this.attemptId) return { success: false, synced: false, message: 'No active attempt' };

    // Record submission state in local store
    if (window.electronAPI?.offline?.setSubmissionState) {
      await window.electronAPI.offline.setSubmissionState(
        this.attemptId,
        'pending_sync',
        `Submitted by student (${autoSubmitted ? 'auto-timed-out' : reason})`
      );
    }
    this.updateState({ submissionState: 'pending_sync' });

    // Try synchronizing and finalizing right away if online
    if (this.state.isOnline) {
      try {
        const syncResult = await this.syncNow(true);
        if (syncResult && syncResult.isFinalized) {
          if (window.electronAPI?.offline?.setSubmissionState) {
            await window.electronAPI.offline.setSubmissionState(this.attemptId, 'submitted');
          }
          this.updateState({ submissionState: 'submitted', syncStatus: 'synced' });
          return {
            success: true,
            synced: true,
            message: 'Assessment submitted and synchronized successfully!',
            result: syncResult
          };
        }
      } catch (err: any) {
        console.warn('[OfflineSyncManager] Immediate online submission sync failed:', err.message);
      }
    }

    // If offline or sync failed, leave in durable pending_sync state
    return {
      success: true,
      synced: false,
      message: 'All answers are securely saved on your device. Submission will complete automatically once connection is restored.'
    };
  }

  public async syncNow(finalizeOnSync = false): Promise<any> {
    if (!this.attemptId || this.isSyncing) return null;

    // Check if Electron has a pending sync payload
    if (!window.electronAPI?.offline?.getPendingSyncPayload) {
      return null;
    }

    this.isSyncing = true;
    this.updateState({ syncStatus: 'syncing', errorMessage: null });

    try {
      const payload = await window.electronAPI.offline.getPendingSyncPayload(this.attemptId);
      if (!payload) {
        this.updateState({ syncStatus: 'synced', pendingCount: 0 });
        this.isSyncing = false;
        return null;
      }

      const totalItems =
        (payload.answers?.length || 0) +
        (payload.answerChanges?.length || 0) +
        (payload.proctoringEvents?.length || 0);

      // If nothing pending and not finalizing, we're all synced
      if (totalItems === 0 && !finalizeOnSync && payload.submissionState?.state !== 'pending_sync') {
        this.updateState({ syncStatus: 'synced', pendingCount: 0 });
        this.isSyncing = false;
        return null;
      }

      const syncPayload = {
        answers: payload.answers || [],
        answerChanges: payload.answerChanges || [],
        proctoringEvents: payload.proctoringEvents || [],
        navigationEvents: payload.navigationEvents || [],
        clientReportedStatus: (finalizeOnSync || payload.submissionState?.state === 'pending_sync') ? 'submitted' : 'in_progress',
        submissionState: payload.submissionState || (finalizeOnSync ? { state: 'pending_sync' } : undefined),
        monotonicTiming: payload.monotonicTiming || undefined
      };

      const res = await attemptsAPI.syncBatch(this.attemptId, syncPayload);

      if (res && res.ok) {
        // Acknowledge the synced items locally
        if (window.electronAPI?.offline?.acknowledgeSync) {
          await window.electronAPI.offline.acknowledgeSync(this.attemptId, {
            acceptedAnswerIds: res.acceptedAnswerIds,
            acceptedEventIds: res.acceptedEventIds,
            acceptedAnswerChangeIds: res.acceptedAnswerChangeIds,
            finalized: res.isFinalized,
            syncTimestamp: res.syncTimestamp
          });
        }

        const remaining = await this.refreshPendingCount();
        this.backoffDelayMs = 2000; // Reset backoff

        this.updateState({
          syncStatus: remaining > 0 ? 'pending' : 'synced',
          lastSyncAt: res.syncTimestamp,
          errorMessage: null,
          submissionState: res.isFinalized ? 'submitted' : this.state.submissionState
        });

        this.isSyncing = false;
        return res;
      } else {
        throw new Error('Sync response did not indicate success');
      }
    } catch (err: any) {
      console.warn('[OfflineSyncManager] Sync failed:', err.message);

      const isConflict = err.message?.includes('finalized') || err.message?.includes('expired');
      const newStatus = isConflict ? 'conflict' : 'failed';

      this.updateState({
        syncStatus: newStatus,
        errorMessage: err.message || 'Sync failed'
      });

      this.isSyncing = false;

      // Exponential backoff retry if network error and not conflict
      if (!isConflict && this.state.isOnline) {
        this.scheduleSync(this.backoffDelayMs);
        this.backoffDelayMs = Math.min(this.backoffDelayMs * 2, this.maxBackoffDelayMs);
      }

      return null;
    }
  }

  public destroy() {
    this.stop();
    this.listeners.clear();
    if (this.cleanupElectronListener) {
      this.cleanupElectronListener();
      this.cleanupElectronListener = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }
}

export const offlineSyncManager = new OfflineSyncManager();
