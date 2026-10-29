import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, ShieldAlert, Maximize, Minimize2, LogOut, User as UserIcon, Monitor } from 'lucide-react';

interface NavbarProps {
  onNavigateHome?: () => void;
  isAssessmentActive?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigateHome, isAssessmentActive }) => {
  const { user, logout } = useAuth();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isElectron = Boolean(window.electronAPI?.isElectron);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (isElectron && window.electronAPI) {
        const nextState = !isFullscreen;
        await window.electronAPI.setFullscreen(nextState);
        setIsFullscreen(nextState);
      } else {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          setIsFullscreen(true);
        } else {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle error:', err);
    }
  };

  return (
    <header className="bg-[#0b1329]/90 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-40 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand / Logo */}
        <div 
          onClick={!isAssessmentActive ? onNavigateHome : undefined} 
          className={`flex items-center space-x-3 ${!isAssessmentActive ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                WUElev8
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Proctor Browser
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Next-Gen Assessment & Integrity Shield</p>
          </div>
        </div>

        {/* Center / Security Indicator */}
        <div className="hidden md:flex items-center space-x-2 bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-full text-xs text-slate-300">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span>Environment: <strong className="text-slate-100">{isElectron ? 'Secure Electron Sandbox' : 'Web Browser'}</strong></span>
          {isAssessmentActive && (
            <span className="ml-2 pl-2 border-l border-slate-700 text-amber-400 font-semibold flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" /> Exam Locked
            </span>
          )}
        </div>

        {/* User profile & action controls */}
        {user ? (
          <div className="flex items-center space-x-3">
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>

            <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400 font-bold text-xs">
                {user.name.charAt(0)}
              </div>
              <div className="hidden sm:block text-left text-xs">
                <div className="font-medium text-slate-200">{user.name}</div>
                <div className="text-[10px] text-slate-400 capitalize flex items-center gap-1">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${user.role === 'admin' ? 'bg-purple-400' : 'bg-blue-400'}`}></span>
                  {user.role}
                </div>
              </div>
            </div>

            {!isAssessmentActive && (
              <button
                onClick={logout}
                title="Sign Out"
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Monitor className="w-4 h-4 text-blue-400" />
            <span>WUElev8 Hackathon Edition</span>
          </div>
        )}

      </div>
    </header>
  );
};
