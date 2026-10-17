import { useAuth } from '@distokoloshe/ui/hooks/useAuth';
import { Login } from '@distokoloshe/ui/pages/Login';
import { RoomPage } from '@distokoloshe/ui/pages/Room';

export function App() {
  const { user, initialized, isLoading, error, login, register, logout, expireSession } = useAuth();

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900">
        <div className="text-center">
          <p className="text-zinc-500">Loading...</p>
          {error && <p className="text-zinc-600 text-sm mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={login} onRegister={register} error={error} isLoading={isLoading} />;
  }

  return <RoomPage user={user} onLogout={logout} onSessionExpired={expireSession} />;
}
