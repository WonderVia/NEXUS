import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { Shield, Lock, Mail, User as UserIcon, KeyRound, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, register, verifyOtp } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'student' | 'admin'>('student');
  
  // OTP flow state
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  
  // Feedback states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fillDemo = (targetRole: 'student' | 'admin') => {
    setError(null);
    setSuccessMsg(null);
    if (targetRole === 'admin') {
      setEmail('admin@wuelev8.com');
      setPassword('Admin@123');
    } else {
      setEmail('student@wuelev8.com');
      setPassword('Student@123');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      await login({ email, password });
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      await register({ name, email, password, role });
      setSuccessMsg('Account created successfully! You are now logged in.');
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestOtp = async () => {
    if (!email) {
      setError('Please enter your email first to receive a verification OTP.');
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const res = await authAPI.requestOtp(email);
      setDevOtpHint(res.devOtp);
      setShowOtpModal(true);
      setSuccessMsg('Verification code sent.');
    } catch (err: any) {
      setError(err.message || 'Failed to request OTP.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await verifyOtp({ email, otp: otpCode });
      setShowOtpModal(false);
    } catch (err: any) {
      setError(err.message || 'OTP verification failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white text-black py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        
        {/* 12-Column Swiss Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          
          {/* Left Column: Index rail and massive display statement (7 cols) */}
          <div className="lg:col-span-7 border-b-2 lg:border-b-0 lg:border-r-2 border-black pb-8 lg:pb-0 lg:pr-12">
            <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-black mb-4 flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#c90000] inline-block"></span>
              <span>01 / INTEGRITY SHIELD PLATFORM</span>
            </div>

            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tighter text-black uppercase leading-[0.92] mb-6">
              WUElev8<br />
              Proctoring<br />
              Browser
            </h1>

            <p className="text-base sm:text-lg text-neutral-800 leading-relaxed max-w-xl mb-8">
              Dedicated assessment runtime environment. Enforces assessment-specific AI usage policies, tab-locking controls, and authoritative candidate authentication.
            </p>

            {/* Quick Demo Credentials Matrix */}
            <div className="border-2 border-black p-5 bg-[#f0f0f0]">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.12em] text-black mb-3 border-b-2 border-black pb-2">
                <span>02 / DEMO CREDENTIAL MATRIX</span>
                <span className="text-[10px] text-neutral-600">ONE-CLICK INJECTION</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => fillDemo('student')}
                  className="p-3 text-xs font-bold bg-white text-black border-2 border-black hover:bg-black hover:text-white transition text-left cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="uppercase tracking-[0.12em]">STUDENT DEMO</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                  <div className="font-mono text-[11px] text-neutral-600 mt-2 font-normal">student@wuelev8.com</div>
                </button>

                <button
                  type="button"
                  onClick={() => fillDemo('admin')}
                  className="p-3 text-xs font-bold bg-white text-black border-2 border-black hover:bg-black hover:text-white transition text-left cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="uppercase tracking-[0.12em]">ADMIN DEMO</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                  <div className="font-mono text-[11px] text-neutral-600 mt-2 font-normal">admin@wuelev8.com</div>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Authentication Card (5 cols) */}
          <div className="lg:col-span-5">
            <div className="border-2 border-black bg-white p-6 sm:p-8">
              
              <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-black mb-4 flex items-center justify-between border-b-2 border-black pb-2">
                <span>03 / AUTHENTICATION GATEWAY</span>
                <span className="w-2 h-2 bg-black inline-block"></span>
              </div>

              {/* Tabs */}
              <div className="flex border-2 border-black mb-6 bg-[#f0f0f0]">
                <button
                  onClick={() => { setTab('login'); setError(null); }}
                  className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-center transition cursor-pointer ${
                    tab === 'login'
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-[#f0f0f0]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setTab('register'); setError(null); }}
                  className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-center border-l-2 border-black transition cursor-pointer ${
                    tab === 'register'
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-[#f0f0f0]'
                  }`}
                >
                  Register
                </button>
              </div>

              {/* Feedback messages */}
              {error && (
                <div className="mb-5 p-3.5 bg-[#f0f0f0] border-2 border-[#c90000] flex items-start space-x-2.5 text-xs text-black">
                  <span className="w-2 h-2 bg-[#c90000] shrink-0 mt-1"></span>
                  <span className="font-medium">{error}</span>
                </div>
              )}

              {successMsg && (
                <div className="mb-5 p-3.5 bg-[#f0f0f0] border-2 border-black flex items-start space-x-2.5 text-xs text-black">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-black" />
                  <span className="font-medium">{successMsg}</span>
                </div>
              )}

              {/* Login Form */}
              {tab === 'login' ? (
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="student@wuelev8.com"
                        className="w-full bg-white border-2 border-black px-3.5 py-2.5 text-sm text-black placeholder-neutral-400 focus:outline-none focus:ring-0 focus:border-black font-sans"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={handleRequestOtp}
                        className="text-[11px] font-bold text-black underline uppercase tracking-[0.12em] hover:text-[#c90000] cursor-pointer"
                      >
                        Use OTP Login
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-white border-2 border-black px-3.5 py-2.5 text-sm text-black placeholder-neutral-400 focus:outline-none focus:ring-0 focus:border-black font-sans"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full mt-3 bg-black hover:bg-neutral-800 text-white font-bold py-3 px-4 border-2 border-black text-xs uppercase tracking-[0.12em] transition cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    {isLoading ? (
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent animate-spin"></span>
                    ) : (
                      <>
                        <span>Authenticate & Enter</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                /* Register Form */
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black mb-1.5">
                      Candidate Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Alex Morgan"
                      className="w-full bg-white border-2 border-black px-3.5 py-2.5 text-sm text-black placeholder-neutral-400 focus:outline-none focus:ring-0 focus:border-black font-sans"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black mb-1.5">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@wuelev8.com"
                      className="w-full bg-white border-2 border-black px-3.5 py-2.5 text-sm text-black placeholder-neutral-400 focus:outline-none focus:ring-0 focus:border-black font-sans"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="w-full bg-white border-2 border-black px-3.5 py-2.5 text-sm text-black placeholder-neutral-400 focus:outline-none focus:ring-0 focus:border-black font-sans"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black mb-1.5">
                      Account Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as any)}
                      className="w-full bg-white border-2 border-black px-3.5 py-2.5 text-sm text-black focus:outline-none focus:ring-0 focus:border-black font-sans"
                    >
                      <option value="student">Student / Candidate</option>
                      <option value="admin">Administrator / Evaluator</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full mt-3 bg-black hover:bg-neutral-800 text-white font-bold py-3 px-4 border-2 border-black text-xs uppercase tracking-[0.12em] transition cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    {isLoading ? (
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent animate-spin"></span>
                    ) : (
                      <>
                        <span>Create Profile & Sign In</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}

            </div>
          </div>

        </div>

        {/* OTP Verification Modal */}
        {showOtpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-md bg-white border-2 border-black p-6 sm:p-8">
              <div className="flex items-center space-x-3 mb-4 border-b-2 border-black pb-3">
                <div className="w-8 h-8 bg-black flex items-center justify-center text-white">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-black text-base uppercase tracking-tight">OTP Verification</h3>
                  <p className="text-xs text-neutral-600 font-mono">Sent to {email}</p>
                </div>
              </div>

              {devOtpHint && (
                <div className="mb-4 p-3 bg-[#f0f0f0] border-2 border-black text-xs text-black">
                  <div className="font-bold uppercase tracking-[0.12em] flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-[#c90000] inline-block"></span>
                    <span>HACKATHON DEV OTP</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-lg font-black tracking-widest">{devOtpHint}</span>
                    <button
                      type="button"
                      onClick={() => setOtpCode(devOtpHint)}
                      className="px-2.5 py-1 text-[11px] bg-black text-white border-2 border-black font-bold uppercase tracking-[0.12em] hover:bg-neutral-800 transition cursor-pointer"
                    >
                      Fill Code
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black mb-1.5">
                    6-Digit Verification Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="000000"
                    className="w-full tracking-widest text-center text-xl font-mono bg-white border-2 border-black py-2.5 text-black focus:outline-none focus:ring-0 focus:border-black"
                  />
                </div>

                <div className="flex space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowOtpModal(false)}
                    className="flex-1 py-2.5 bg-white hover:bg-[#f0f0f0] text-black border-2 border-black font-bold text-xs uppercase tracking-[0.12em] transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || otpCode.length < 6}
                    className="flex-1 py-2.5 bg-black hover:bg-neutral-800 text-white border-2 border-black font-bold text-xs uppercase tracking-[0.12em] transition disabled:opacity-50 cursor-pointer"
                  >
                    {isLoading ? 'Verifying...' : 'Confirm OTP'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
