import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { Navbar } from './components/Navbar';
import { LoginPage } from './pages/LoginPage';
import { StudentDashboard } from './pages/StudentDashboard';
import { PreAssessmentCheck } from './pages/PreAssessmentCheck';
import { AssessmentPage } from './pages/AssessmentPage';
import { AssessmentResultPage } from './pages/AssessmentResultPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { Assessment } from './types';

function MainApp() {
  const { user, isLoading } = useAuth();

  // Navigation states for student workflow
  const [currentScreen, setCurrentScreen] = useState<'dashboard' | 'check' | 'assessment' | 'result'>('dashboard');
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [submissionResult, setSubmissionResult] = useState<any>(null);
  const [forceNewAttempt, setForceNewAttempt] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center text-black font-swiss">
        <div className="w-8 h-8 border-2 border-black border-t-transparent animate-spin mb-4"></div>
        <p className="text-xs font-bold uppercase tracking-[0.12em]">
          [00] INITIALIZING SECURE PROCTOR ENVIRONMENT
        </p>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col font-swiss">
        <Navbar />
        <LoginPage />
      </div>
    );
  }

  // Admin Portal
  if (user.role === 'admin') {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col font-swiss">
        <Navbar />
        <main className="flex-1">
          <AdminDashboard />
        </main>
      </div>
    );
  }

  // Student Flow
  const handleSelectAssessment = (assessment: Assessment, mode: 'take' | 'review', forceNew: boolean = false) => {
    setActiveAssessment(assessment);
    setSubmissionResult(null);
    setForceNewAttempt(forceNew);
    if (mode === 'review') {
      setCurrentScreen('result');
    } else {
      setCurrentScreen('check');
    }
  };

  const handlePassedSystemCheck = () => {
    setCurrentScreen('assessment');
  };

  const handleFinishAssessment = (result: any) => {
    setSubmissionResult(result);
    setForceNewAttempt(false);
    setCurrentScreen('result');
  };

  const handleReturnToDashboard = () => {
    setActiveAssessment(null);
    setSubmissionResult(null);
    setForceNewAttempt(false);
    setCurrentScreen('dashboard');
  };

  return (
    <div className="min-h-screen bg-white text-black flex flex-col font-swiss">
      <Navbar 
        onNavigateHome={handleReturnToDashboard}
        isAssessmentActive={currentScreen === 'assessment'}
      />
      <main className="flex-1">
        {currentScreen === 'dashboard' && (
          <StudentDashboard onSelectAssessment={handleSelectAssessment} />
        )}

        {currentScreen === 'check' && activeAssessment && (
          <PreAssessmentCheck
            assessment={activeAssessment}
            onProceed={handlePassedSystemCheck}
            onCancel={handleReturnToDashboard}
          />
        )}

        {currentScreen === 'assessment' && activeAssessment && (
          <AssessmentPage
            assessment={activeAssessment}
            forceNew={forceNewAttempt}
            onFinish={handleFinishAssessment}
            onExit={handleReturnToDashboard}
          />
        )}

        {currentScreen === 'result' && activeAssessment && (
          <AssessmentResultPage
            assessment={activeAssessment}
            resultData={submissionResult}
            onBack={handleReturnToDashboard}
            onRetake={() => handleSelectAssessment(activeAssessment, 'take', true)}
          />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ThemeProvider>
  );
}
