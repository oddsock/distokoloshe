import { useState, useCallback } from 'react';
import { useAuth } from '@distokoloshe/ui/hooks/useAuth';
import { Login } from '@distokoloshe/ui/pages/Login';
import { RoomPage } from '@distokoloshe/ui/pages/Room';
import { getBaseUrl, setBaseUrl, clearStoredToken } from '@distokoloshe/ui/lib/api';
import { ServerConfig } from './ServerConfig';

export function App() {
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const { user, initialized, isLoading, error, login, register, logout } = useAuth();

  const handleServerConnect = useCallback((url: string) => {
    setBaseUrl(url);
    setServerUrl(url);
  }, []);

  const handleDisconnect = useCallback(() => {
    clearStoredToken();
    setBaseUrl('');
    setServerUrl('');
    window.location.reload();
  }, []);

  // First-launch: no server URL configured
  if (!serverUrl) {
    return <ServerConfig onConnect={handleServerConnect} />;
  }

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900">
        <div className="text-center">
          <p className="text-zinc-500 mb-4">Connecting to {serverUrl}...</p>
          <button
            onClick={handleDisconnect}
            className="text-sm text-zinc-600 hover:text-zinc-400 underline"
          >
            Change server
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <Login onLogin={login} onRegister={register} error={error} isLoading={isLoading} />
        <div className="fixed bottom-4 left-0 right-0 text-center">
          <button
            onClick={handleDisconnect}
            className="text-sm text-zinc-600 hover:text-zinc-400 underline"
          >
            Change server
          </button>
        </div>
      </div>
    );
  }

  return <RoomPage user={user} onLogout={logout} />;
}
