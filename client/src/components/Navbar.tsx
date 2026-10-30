import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Shield, ShieldAlert, Maximize, Minimize2, LogOut, Monitor, Sun, Moon } from 'lucide-react';

interface NavbarProps {
  onNavigateHome?: () => void;
  isAssessmentActive?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigateHome, isAssessmentActive }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
    <header className="bg-white border-b-2 border-black sticky top-0 z-40 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand / Logo */}
        <div 
          onClick={!isAssessmentActive ? onNavigateHome : undefined} 
          className={`flex items-center space-x-3.5 ${!isAssessmentActive ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          <div className="relative w-9 h-9 bg-black flex items-center justify-center text-white border-2 border-black">
            <Shield className="w-5 h-5 text-white" />
            <div className="absolute top-0 right-0 w-2 h-2 bg-[#c90000]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-tighter text-black uppercase">
                WUElev8
              </span>
              <span className="text-[11px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-black text-white">
                Proctor Browser
              </span>
            </div>
            <p className="text-[11px] text-neutral-600 font-medium tracking-tight">Next-Gen Assessment & Integrity Shield</p>
          </div>
        </div>

        {/* Center / Security Indicator */}
        <div className="hidden md:flex items-center space-x-2.5 bg-[#f0f0f0] border-2 border-black px-3.5 py-1 text-xs text-black">
          <div className="w-2 h-2 bg-black" />
          <span className="tracking-tight uppercase text-[11px] font-bold">
            Environment: <strong className="font-extrabold">{isElectron ? 'Secure Electron Sandbox' : 'Web Browser'}</strong>
          </span>
          {isAssessmentActive && (
            <span className="ml-2 pl-2 border-l-2 border-black text-[#c90000] font-bold flex items-center gap-1 uppercase tracking-[0.12em]">
              <ShieldAlert className="w-3.5 h-3.5" /> Exam Locked
            </span>
          )}
        </div>

        {/* Action Controls & Profile */}
        <div className="flex items-center space-x-2.5">
          {/* Dark / Light Screen Mode Toggle */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Screen Mode'}
            aria-label="Toggle dark screen mode"
            className="p-2 text-black bg-white hover:bg-black hover:text-white border-2 border-black transition cursor-pointer flex items-center gap-1.5"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-4 h-4 text-black" />
                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-[0.12em]">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-black" />
                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-[0.12em]">Dark</span>
              </>
            )}
          </button>

          {user ? (
            <>
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                className="p-2 text-black bg-white hover:bg-black hover:text-white border-2 border-black transition cursor-pointer"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>

              <div className="flex items-center space-x-2 pl-2.5 border-l-2 border-black">
                <div className="w-8 h-8 bg-black border-2 border-black flex items-center justify-center text-white font-bold text-xs uppercase">
                  {user.name.charAt(0)}
                </div>
                <div className="hidden sm:block text-left text-xs">
                  <div className="font-bold text-black uppercase tracking-tight">{user.name}</div>
                  <div className="text-[10px] text-neutral-600 uppercase tracking-[0.12em] font-semibold flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 ${user.role === 'admin' ? 'bg-[#c90000]' : 'bg-black'}`} />
                    {user.role}
                  </div>
                </div>
              </div>

              {!isAssessmentActive && (
                <button
                  onClick={logout}
                  title="Sign Out"
                  className="p-2 text-black bg-white hover:bg-[#c90000] hover:text-white border-2 border-black transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <div className="hidden sm:flex items-center space-x-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-600 pl-2 border-l-2 border-black">
              <Monitor className="w-4 h-4 text-black" />
              <span>WUElev8 Hackathon Edition</span>
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
