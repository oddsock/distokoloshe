import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { RoomPage } from './pages/Room';

export function App() {
  const { user, initialized, isLoading, error, login, register, logout } = useAuth();

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={login} onRegister={register} error={error} isLoading={isLoading} />;
  }

  return <RoomPage user={user} onLogout={logout} />;
}
