import React, { useState, useEffect, useRef } from 'react';
import { Assessment } from '../types';
import { useAuth } from '../context/AuthContext';
import { analyzeWebcamFrame } from '../services/faceDetection';
import { 
  Camera, Mic, Wifi, Maximize, ShieldAlert, CheckCircle2, 
  XCircle, AlertTriangle, ArrowRight, ArrowLeft, RefreshCw, Volume2 
} from 'lucide-react';
import { getApiBase } from '../services/api';

interface PreAssessmentCheckProps {
  assessment: Assessment;
  onProceed: () => void;
  onCancel: () => void;
}

export const PreAssessmentCheck: React.FC<PreAssessmentCheckProps> = ({ assessment, onProceed, onCancel }) => {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Verification checklist states
  const [cameraGranted, setCameraGranted] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [networkOk, setNetworkOk] = useState(false);
  const [networkPing, setNetworkPing] = useState<number | null>(null);
  const [fullscreenOk, setFullscreenOk] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);

  // Status and error tracking
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // Setup media streams
  useEffect(() => {
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let audioAnimFrame: number;
    let cvInterval: any;

    async function initMedia() {
      try {
        setCameraError(null);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: { ideal: 30 } },
          audio: true
        });

        setMediaStream(stream);
        setCameraGranted(true);
        setMicGranted(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.warn('Video play error:', e));
        }

        // Setup Web Audio Analyser for live mic meter
        try {
          audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const source = audioContext.createMediaStreamSource(stream);
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioLevel = () => {
            if (analyser) {
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const average = sum / dataArray.length;
              setAudioLevel(Math.min(100, Math.round((average / 128) * 100)));
            }
            audioAnimFrame = requestAnimationFrame(updateAudioLevel);
          };
          updateAudioLevel();
        } catch (e) {
          console.warn('Audio analyser error:', e);
        }

        // Start real-time face detection
        cvInterval = setInterval(async () => {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            const res = await analyzeWebcamFrame(videoRef.current);
            setFaceDetected(res.faceCount > 0);
          }
        }, 600);

      } catch (err: any) {
        console.warn('Media access error:', err);
        setCameraError(err.message || 'Permission denied or webcam in use by another app.');
        setCameraGranted(false);
      }
    }

    initMedia();

    // Check Network Connectivity & Ping to backend
    async function checkNetwork() {
      // Derive health URL from the API base so it works in both Vite dev (proxy)
      // and Electron production (absolute URL) modes.
      const apiBase = getApiBase(); // e.g. '/api' or 'http://localhost:5000/api'
      const healthUrl = apiBase.startsWith('http')
        ? apiBase.replace(/\/api\/?$/, '/health')
        : '/health';
      const start = performance.now();
      try {
        const res = await fetch(healthUrl);
        if (res.ok) {
          const latency = Math.round(performance.now() - start);
          setNetworkPing(latency);
          setNetworkOk(true);
        } else {
          setNetworkOk(false);
        }
      } catch (e) {
        setNetworkOk(false);
      }
    }
    checkNetwork();

    // Check Fullscreen state
    const handleFsChange = async () => {
      if (window.electronAPI) {
        try {
          const isFs = await window.electronAPI.getFullscreen();
          setFullscreenOk(Boolean(isFs || document.fullscreenElement));
        } catch {
          setFullscreenOk(Boolean(document.fullscreenElement));
        }
      } else {
        setFullscreenOk(Boolean(document.fullscreenElement));
      }
    };
    handleFsChange();
    document.addEventListener('fullscreenchange', handleFsChange);

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      if (audioContext) {
        audioContext.close().catch(() => {});
      }
      cancelAnimationFrame(audioAnimFrame);
      clearInterval(cvInterval);
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, []);

  const requestFullscreen = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.setFullscreen(true);
        setFullscreenOk(true);
      } else {
        await document.documentElement.requestFullscreen();
        setFullscreenOk(true);
      }
    } catch (err) {
      console.warn('Fullscreen request error:', err);
    }
  };

  const allChecksPassed = cameraGranted && faceDetected && micGranted && networkOk && fullscreenOk && rulesAccepted;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
        <div>
          <button 
            onClick={onCancel}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 mb-2 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Return to Dashboard
          </button>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-blue-400" />
            Pre-Assessment System Verification
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Validating hardware permissions, network latency, and test environment for: <strong className="text-slate-200">{assessment.title}</strong>
          </p>
        </div>

        <div className="hidden sm:block text-right">
          <span className="text-xs px-3 py-1 rounded-full font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Step 1 of 2: Readiness
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Live Camera & Microphone Test (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-400" /> Live Webcam Feed
              </h3>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1 ${
                faceDetected 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                {faceDetected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                {faceDetected ? 'Face Verified in Frame' : 'Detecting Face...'}
              </span>
            </div>

            {/* Video Canvas Container */}
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />

              {cameraError && (
                <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
                  <XCircle className="w-10 h-10 text-red-400 mb-2" />
                  <p className="text-sm font-bold text-white">Camera Access Denied or Unavailable</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">{cameraError}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition"
                  >
                    Retry Permission
                  </button>
                </div>
              )}

              {/* Face Guide Target Overlay */}
              {cameraGranted && !cameraError && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className={`w-48 h-60 rounded-full border-2 border-dashed transition-colors duration-300 ${
                    faceDetected ? 'border-emerald-500/60 shadow-lg shadow-emerald-500/20' : 'border-amber-400/40 animate-pulse'
                  }`}></div>
                </div>
              )}
            </div>

            {/* Microphone Volume Level Bar */}
            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-indigo-400" /> Microphone Input Level
                </span>
                <span className="font-mono text-slate-300">{audioLevel}%</span>
              </div>
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-75 rounded-full"
                  style={{ width: `${audioLevel}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Privacy & Technical Disclosure */}
          <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4 text-xs text-slate-400 leading-relaxed">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-200">System Transparency Notice:</strong> Face detection is performed locally in client memory using WebAssembly / TensorFlow.js. Video frames are analyzed in real-time and discarded immediately. No continuous video recording is stored or uploaded by default.
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Interactive System Checklist & Consent (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-4">Hardware & Environment Checklist</h3>

            <div className="space-y-3">
              {/* Check 1: Camera Permission */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="flex items-center space-x-3">
                  <Camera className="w-4 h-4 text-blue-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Webcam Permission</div>
                    <div className="text-[10px] text-slate-400">Video feed active</div>
                  </div>
                </div>
                {cameraGranted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>

              {/* Check 2: Face in Camera */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="flex items-center space-x-3">
                  <ShieldAlert className="w-4 h-4 text-indigo-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Face Visible in Frame</div>
                    <div className="text-[10px] text-slate-400">Position head in the guide ring</div>
                  </div>
                </div>
                {faceDetected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">Waiting</span>
                )}
              </div>

              {/* Check 3: Microphone */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="flex items-center space-x-3">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Microphone Input</div>
                    <div className="text-[10px] text-slate-400">Audio capture enabled</div>
                  </div>
                </div>
                {micGranted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>

              {/* Check 4: Network Connectivity */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="flex items-center space-x-3">
                  <Wifi className="w-4 h-4 text-emerald-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Network Connectivity</div>
                    <div className="text-[10px] text-slate-400">Latency: {networkPing ? `${networkPing} ms` : 'Checking...'}</div>
                  </div>
                </div>
                {networkOk ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>

              {/* Check 5: Fullscreen Mode */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="flex items-center space-x-3">
                  <Maximize className="w-4 h-4 text-purple-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Fullscreen Locked</div>
                    <div className="text-[10px] text-slate-400">Required during assessment</div>
                  </div>
                </div>
                {fullscreenOk ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <button
                    onClick={requestFullscreen}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 rounded-lg transition"
                  >
                    Enter Fullscreen
                  </button>
                )}
              </div>
            </div>

            {/* Assessment Rules & Privacy Consent */}
            <div className="mt-6 pt-5 border-t border-slate-800 space-y-3">
              <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-800/40 text-[11px] text-purple-200 leading-relaxed">
                <div className="font-bold text-purple-300 flex items-center gap-1.5 mb-1 text-xs">
                  <span>🛡️</span>
                  <span>External Activity & Prompt Monitoring Disclosure</span>
                </div>
                During active assessments, external website visits (e.g. ChatGPT, Claude, search engines) and submitted AI prompts/queries are monitored and recorded into the proctoring audit log. Assessments will continue running without blocking or termination, and collected telemetry will be submitted solely for academic review.
              </div>

              <label className="flex items-start space-x-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rulesAccepted}
                  onChange={(e) => setRulesAccepted(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                />
                <span className="text-xs text-slate-300 leading-normal">
                  I acknowledge and consent to active assessment proctoring (camera presence, application focus, and external website/AI prompt auditing), and confirm my identity as <strong className="text-white">{user?.name}</strong>.
                </span>
              </label>
            </div>

            {/* Launch Assessment Action */}
            <div className="mt-6">
              <button
                disabled={!allChecksPassed}
                onClick={onProceed}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-2 text-sm"
              >
                <span>All Checks Passed — Begin Assessment</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {!allChecksPassed && (
                <p className="text-[11px] text-center text-slate-500 mt-2">
                  Complete all checks above and accept the guidelines to start.
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
