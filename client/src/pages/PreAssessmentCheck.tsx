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
      const apiBase = getApiBase();
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-white text-black">
      
      {/* Top Header Rail */}
      <div className="border-b-2 border-black pb-4 mb-8">
        <div className="flex items-center justify-between mb-3">
          <button 
            onClick={onCancel}
            className="text-xs font-bold uppercase tracking-[0.12em] text-black hover:text-[#c90000] flex items-center gap-1.5 transition cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Return to Dashboard
          </button>

          <span className="text-[11px] px-2.5 py-1 bg-black text-white font-bold uppercase tracking-[0.12em]">
            STEP 01 / HARDWARE READINESS
          </span>
        </div>

        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-black flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 bg-[#c90000] inline-block"></span>
          <span>SYSTEM VERIFICATION & PROCTORING CHECK</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tighter text-black uppercase leading-[0.95]">
          {assessment.title}
        </h1>
        <p className="text-xs text-neutral-600 mt-2 font-medium">
          Authoritative hardware verification, network latency evaluation, and integrity rule acknowledgment.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Live Camera & Microphone Test (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="border-2 border-black bg-white p-5">
            <div className="flex items-center justify-between mb-3 border-b-2 border-black pb-2">
              <div className="text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-2">
                <Camera className="w-4 h-4 text-black" />
                <span>01 / LIVE WEBCAM FEED</span>
              </div>
              <span className={`text-[11px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 ${
                faceDetected 
                  ? 'bg-black text-white' 
                  : 'bg-[#f0f0f0] border-2 border-black text-black'
              }`}>
                {faceDetected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Face Verified</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 bg-[#c90000] inline-block animate-pulse"></span>
                    <span>Detecting Face...</span>
                  </>
                )}
              </span>
            </div>

            {/* Video Container (Strict Rectangular Crop) */}
            <div className="relative aspect-video bg-black overflow-hidden border-2 border-black flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />

              {cameraError && (
                <div className="absolute inset-0 bg-white flex flex-col items-center justify-center p-6 text-center border-2 border-[#c90000]">
                  <span className="w-3 h-3 bg-[#c90000] mb-2"></span>
                  <p className="text-sm font-extrabold uppercase tracking-tight text-black">Camera Access Denied or Unavailable</p>
                  <p className="text-xs text-neutral-600 mt-1 max-w-sm">{cameraError}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-2 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
                  >
                    Retry Permission
                  </button>
                </div>
              )}

              {/* Face Guide Target Overlay (Rectangular) */}
              {cameraGranted && !cameraError && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className={`w-52 h-64 border-2 border-dashed ${
                    faceDetected ? 'border-white' : 'border-[#c90000]'
                  }`}></div>
                </div>
              )}
            </div>

            {/* Microphone Volume Level Bar */}
            <div className="mt-4 pt-4 border-t-2 border-black">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 text-black">
                  <Mic className="w-3.5 h-3.5 text-black" /> Microphone Input Level
                </span>
                <span className="font-mono font-bold text-black">{audioLevel}%</span>
              </div>
              <div className="w-full h-3 bg-[#f0f0f0] border-2 border-black overflow-hidden">
                <div 
                  className="h-full bg-black transition-none"
                  style={{ width: `${audioLevel}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Technical Disclosure */}
          <div className="border-2 border-black bg-[#f0f0f0] p-4 text-xs text-black leading-relaxed">
            <div className="flex items-start gap-2.5">
              <span className="w-2.5 h-2.5 bg-black shrink-0 mt-1"></span>
              <div>
                <strong className="uppercase tracking-[0.12em] font-bold">Client-Side Privacy Architecture:</strong> Face presence is evaluated locally in browser memory via WebAssembly / TensorFlow.js. Video frames are discarded instantaneously; no continuous camera stream is transmitted or persisted without infraction triggers.
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Hardware & Policy Matrix (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="border-2 border-black bg-white p-5">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-black mb-4 border-b-2 border-black pb-2 flex items-center justify-between">
              <span>02 / HARDWARE VERIFICATION CHECKLIST</span>
              <span className="w-2 h-2 bg-black"></span>
            </div>

            {/* Checklist Matrix */}
            <div className="border-2 border-black bg-[#f0f0f0] divide-y-2 divide-black">
              {/* Check 1: Camera Permission */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center space-x-3">
                  <Camera className="w-4 h-4 text-black" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-black">Webcam Permission</div>
                    <div className="text-[10px] text-neutral-600 font-mono">Stream initialized</div>
                  </div>
                </div>
                {cameraGranted ? (
                  <CheckCircle2 className="w-4 h-4 text-black" />
                ) : (
                  <span className="w-2 h-2 bg-[#c90000]"></span>
                )}
              </div>

              {/* Check 2: Face in Camera */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center space-x-3">
                  <ShieldAlert className="w-4 h-4 text-black" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-black">Face Visible in Frame</div>
                    <div className="text-[10px] text-neutral-600 font-mono">Single face required</div>
                  </div>
                </div>
                {faceDetected ? (
                  <CheckCircle2 className="w-4 h-4 text-black" />
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] bg-black text-white px-2 py-0.5">Pending</span>
                )}
              </div>

              {/* Check 3: Microphone */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center space-x-3">
                  <Volume2 className="w-4 h-4 text-black" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-black">Microphone Input</div>
                    <div className="text-[10px] text-neutral-600 font-mono">Audio meter active</div>
                  </div>
                </div>
                {micGranted ? (
                  <CheckCircle2 className="w-4 h-4 text-black" />
                ) : (
                  <span className="w-2 h-2 bg-[#c90000]"></span>
                )}
              </div>

              {/* Check 4: Network Connectivity */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center space-x-3">
                  <Wifi className="w-4 h-4 text-black" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-black">Network Latency</div>
                    <div className="text-[10px] text-neutral-600 font-mono">{networkPing ? `${networkPing} ms` : 'Evaluating...'}</div>
                  </div>
                </div>
                {networkOk ? (
                  <CheckCircle2 className="w-4 h-4 text-black" />
                ) : (
                  <span className="w-2 h-2 bg-[#c90000]"></span>
                )}
              </div>

              {/* Check 5: Fullscreen Mode */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center space-x-3">
                  <Maximize className="w-4 h-4 text-black" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.12em] text-black">Fullscreen Locked</div>
                    <div className="text-[10px] text-neutral-600 font-mono">Required during exam</div>
                  </div>
                </div>
                {fullscreenOk ? (
                  <CheckCircle2 className="w-4 h-4 text-black" />
                ) : (
                  <button
                    onClick={requestFullscreen}
                    className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] bg-black text-white hover:bg-neutral-800 transition cursor-pointer"
                  >
                    Lock Fullscreen
                  </button>
                )}
              </div>
            </div>

            {/* Assessment Security Directive Callout */}
            <div className="mt-5 border-2 border-black p-4 bg-[#f0f0f0] text-xs leading-relaxed">
              <div className="font-bold uppercase tracking-[0.12em] flex items-center gap-2 mb-2 pb-2 border-b-2 border-black">
                <span className={`w-2 h-2 ${assessment.policy.aiUsage === 'allowed' ? 'bg-black' : 'bg-[#c90000]'}`} />
                <span>
                  {assessment.policy.aiUsage === 'allowed'
                    ? 'AI PERMITTED — CANDIDATE PROMPTS AUDITED'
                    : 'AI PROHIBITED — STRICT INTEGRITY ENVIRONMENT'}
                </span>
              </div>
              {assessment.policy.aiUsage === 'allowed' ? (
                <p className="text-neutral-800">
                  You are permitted to interact with supported AI tools. Prompts and responses will be logged and displayed to evaluators. AI usage is <strong>not</strong> treated as a violation.
                </p>
              ) : (
                <p className="text-neutral-800">
                  AI tools and unauthorized tab switches are strictly <strong>prohibited</strong>. Policy handling is set to <strong>{(assessment.policy.violationHandling || 'terminate').toUpperCase()}</strong>. Infractions will record critical violation events.
                </p>
              )}
            </div>

            {/* Candidate Consent Checkbox */}
            <div className="mt-4 pt-4 border-t-2 border-black">
              <label className="flex items-start space-x-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rulesAccepted}
                  onChange={(e) => setRulesAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 border-2 border-black bg-white text-black focus:ring-0 focus:outline-none"
                />
                <span className="text-xs text-neutral-800 leading-normal font-medium">
                  I confirm my identity as <strong className="font-bold text-black">{user?.name}</strong> and consent to active proctoring monitoring according to this assessment's security policy.
                </span>
              </label>
            </div>

            {/* Proceed Action Button */}
            <div className="mt-6">
              <button
                disabled={!allChecksPassed}
                onClick={onProceed}
                className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white font-bold border-2 border-black text-xs uppercase tracking-[0.12em] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                <span>All Checks Passed — Begin Assessment</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {!allChecksPassed && (
                <p className="text-[11px] text-center text-neutral-600 uppercase tracking-[0.12em] mt-2 font-bold">
                  Complete all 5 hardware checks and consent above to unlock.
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
