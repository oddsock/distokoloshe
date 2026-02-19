import type { UserListItem } from '../lib/api';

interface UserListProps {
  users: UserListItem[];
  currentUserId: number;
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return 'Never';
  const date = new Date(lastSeen + 'Z'); // SQLite datetime is UTC
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function UserList({ users, currentUserId }: UserListProps) {
  const otherUsers = users.filter((u) => u.id !== currentUserId);
  const onlineUsers = otherUsers.filter((u) => u.is_online);
  const offlineUsers = otherUsers.filter((u) => !u.is_online);

  return (
    <aside className="w-52 bg-white dark:bg-zinc-800 border-l border-zinc-200 dark:border-zinc-700 flex flex-col">
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="text-xs font-semibold uppercase text-zinc-500">Members</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Online */}
        {onlineUsers.length > 0 && (
          <>
            <p className="text-xs font-semibold text-green-500 px-2 py-1 mt-1">
              Online — {onlineUsers.length}
            </p>
            {onlineUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                <div className="relative">
                  <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                    {u.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-white dark:border-zinc-800" />
                </div>
                <span className="text-sm truncate text-zinc-800 dark:text-zinc-200">
                  {u.display_name}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Offline */}
        {offlineUsers.length > 0 && (
          <>
            <p className="text-xs font-semibold text-zinc-500 px-2 py-1 mt-3">
              Offline — {offlineUsers.length}
            </p>
            {offlineUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg opacity-50">
                <div className="w-7 h-7 rounded-full bg-zinc-600 flex items-center justify-center text-xs font-bold text-zinc-300">
                  {u.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm truncate text-zinc-400">{u.display_name}</p>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
                    {formatLastSeen(u.last_seen)}
                  </p>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
