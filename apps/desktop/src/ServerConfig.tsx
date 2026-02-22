import { useState } from 'react';
import { Server } from 'lucide-react';

interface ServerConfigProps {
  onConnect: (url: string) => void;
}

export function ServerConfig({ onConnect }: ServerConfigProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let serverUrl = url.trim().replace(/\/+$/, '');
    if (!serverUrl) return;

    // Auto-add https:// if no protocol specified
    if (!/^https?:\/\//.test(serverUrl)) {
      serverUrl = `https://${serverUrl}`;
    }

    setTesting(true);
    try {
      // Test connection by hitting a known endpoint
      const res = await fetch(`${serverUrl}/api/rooms`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401 || res.ok) {
        // 401 = server exists, auth required (expected). 200 = also fine.
        onConnect(serverUrl);
      } else {
        setError(`Server responded with ${res.status}`);
      }
    } catch {
      setError('Could not reach server. Check the URL and try again.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-800 rounded-xl shadow-2xl p-8">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Server size={24} className="text-indigo-500" />
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            disTokoloshe
          </h1>
        </div>

        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-6">
          Enter the URL of your disTokoloshe server to get started.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Server URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="distokoloshe.example.com"
              required
              autoFocus
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={testing}
            className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {testing ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}
