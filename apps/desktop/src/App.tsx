import { useState, useCallback } from 'react';
import { useAuth } from '@distokoloshe/ui/hooks/useAuth';
import { Login } from '@distokoloshe/ui/pages/Login';
import { RoomPage } from '@distokoloshe/ui/pages/Room';
import { getBaseUrl, setBaseUrl } from '@distokoloshe/ui/lib/api';
import { ServerConfig } from './ServerConfig';

export function App() {
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const { user, initialized, isLoading, error, login, register, logout } = useAuth();

  const handleServerConnect = useCallback((url: string) => {
    setBaseUrl(url);
    setServerUrl(url);
  }, []);

  // First-launch: no server URL configured
  if (!serverUrl) {
    return <ServerConfig onConnect={handleServerConnect} />;
  }

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900">
        <p className="text-zinc-500">Connecting...</p>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={login} onRegister={register} error={error} isLoading={isLoading} />;
  }

  return <RoomPage user={user} onLogout={logout} />;
}
