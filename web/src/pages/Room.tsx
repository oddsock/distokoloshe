import { useState, useEffect, useCallback } from 'react';
import { ConnectionState, Track, RoomEvent } from 'livekit-client';
import type { RemoteTrackPublication, RemoteParticipant, TrackPublication } from 'livekit-client';
import { useLiveKitRoom, type RoomConnection } from '../hooks/useLiveKitRoom';
import { useAudioMixer } from '../hooks/useAudioMixer';
import { useScreenShare, QUALITY_PRESETS, type ShareQuality } from '../hooks/useScreenShare';
import { useEvents } from '../hooks/useEvents';
import { DeviceSettings } from '../components/DeviceSettings';
import { VolumeSlider } from '../components/VolumeSlider';
import { ScreenShareView } from '../components/ScreenShareView';
import { UserList } from '../components/UserList';
import { getRoomInitials, toggleTheme, getTheme } from '../lib/utils';
import * as api from '../lib/api';

interface RoomPageProps {
  user: api.User;
  onLogout: () => void;
}

export function RoomPage({ user, onLogout }: RoomPageProps) {
  const [rooms, setRooms] = useState<api.Room[]>([]);
  const [users, setUsers] = useState<api.UserListItem[]>([]);
  const [roomMembers, setRoomMembers] = useState<Record<number, api.RoomMember[]>>({});
  const [currentRoom, setCurrentRoom] = useState<api.Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVolumes, setShowVolumes] = useState(false);
  const [theme, setThemeState] = useState<'dark' | 'light'>(getTheme);

  const {
    room,
    localParticipant,
    remoteParticipants,
    connectionState,
    connect,
    disconnect,
  } = useLiveKitRoom();

  const { attachTrack, detachTrack, setVolume, getVolume } = useAudioMixer();
  const {
    isSharing,
    shareQuality,
    shareAudio,
    setShareAudio,
    startScreenShare,
    stopScreenShare,
  } = useScreenShare(room);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [shareViewMode, setShareViewMode] = useState<'spotlight' | 'grid'>('spotlight');
  const [spotlightIndex, setSpotlightIndex] = useState(0);

  // Collect all screen shares from remote participants
  const screenShares: Array<{ participant: RemoteParticipant; publication: RemoteTrackPublication }> = [];
  for (const p of remoteParticipants) {
    for (const pub of p.trackPublications.values()) {
      if (pub.source === Track.Source.ScreenShare && pub.isSubscribed) {
        screenShares.push({ participant: p, publication: pub });
      }
    }
  }

  // Local screen share track for self-preview
  const localScreenShare: TrackPublication | undefined = isSharing && room
    ? Array.from(room.localParticipant.trackPublications.values()).find(
        (pub) => pub.source === Track.Source.ScreenShare && pub.track,
      )
    : undefined;

  // Clamp spotlight index
  const effectiveSpotlight = screenShares.length > 0
    ? Math.min(spotlightIndex, screenShares.length - 1)
    : 0;

  // Load initial data
  useEffect(() => {
    api.listRooms().then(({ rooms }) => setRooms(rooms)).catch(() => {});
    api.listUsers().then(({ users }) => setUsers(users)).catch(() => {});
    api.listRoomMembers().then(({ members }) => {
      // API returns string keys, convert to number keys
      const parsed: Record<number, api.RoomMember[]> = {};
      for (const [k, v] of Object.entries(members)) parsed[Number(k)] = v;
      setRoomMembers(parsed);
    }).catch(() => {});
  }, []);

  // SSE events for real-time updates
  useEvents({
    'room:created': (data) => {
      const { room: newRoom } = data as { room: api.Room };
      setRooms((prev) => {
        if (prev.some((r) => r.id === newRoom.id)) return prev;
        return [...prev, newRoom].sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    'room:deleted': (data) => {
      const { room: deletedRoom } = data as { room: api.Room };
      setRooms((prev) => prev.filter((r) => r.id !== deletedRoom.id));
    },
    'user:online': (data) => {
      const { user: onlineUser } = data as { user: { id: number; username: string; display_name: string } };
      setUsers((prev) => {
        const updated = prev.map((u) => u.id === onlineUser.id ? { ...u, is_online: true } : u);
        // If user not in list (new registration), add them
        if (!prev.some((u) => u.id === onlineUser.id)) {
          updated.push({ ...onlineUser, last_seen: null, is_online: true });
        }
        return updated.sort((a, b) => {
          if (a.is_online && !b.is_online) return -1;
          if (!a.is_online && b.is_online) return 1;
          return a.display_name.localeCompare(b.display_name);
        });
      });
    },
    'user:offline': (data) => {
      const { user: offlineUser } = data as { user: { id: number } };
      setUsers((prev) =>
        prev
          .map((u) => u.id === offlineUser.id ? { ...u, is_online: false, last_seen: new Date().toISOString() } : u)
          .sort((a, b) => {
            if (a.is_online && !b.is_online) return -1;
            if (!a.is_online && b.is_online) return 1;
            return a.display_name.localeCompare(b.display_name);
          }),
      );
    },
    'user:room_join': (data) => {
      const { user: joinUser, roomId } = data as { user: api.RoomMember; roomId: number };
      setRoomMembers((prev) => {
        const next = { ...prev };
        // Remove from any previous room
        for (const rid of Object.keys(next)) {
          next[Number(rid)] = next[Number(rid)].filter((m) => m.id !== joinUser.id);
          if (next[Number(rid)].length === 0) delete next[Number(rid)];
        }
        // Add to new room
        next[roomId] = [...(next[roomId] || []), joinUser];
        return next;
      });
    },
    'user:room_leave': (data) => {
      const { user: leaveUser, roomId } = data as { user: { id: number }; roomId: number };
      setRoomMembers((prev) => {
        const next = { ...prev };
        if (next[roomId]) {
          next[roomId] = next[roomId].filter((m) => m.id !== leaveUser.id);
          if (next[roomId].length === 0) delete next[roomId];
        }
        return next;
      });
    },
  });

  // Close quality menu on outside click
  useEffect(() => {
    if (!showQualityMenu) return;
    const close = () => setShowQualityMenu(false);
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [showQualityMenu]);

  // Attach audio tracks for per-user volume control
  useEffect(() => {
    if (!room) return;

    const handleTrackSubscribed = (
      _track: unknown,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.kind === Track.Kind.Audio) {
        attachTrack(participant, publication);
      }
    };

    const handleTrackUnsubscribed = (
      _track: unknown,
      _publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      detachTrack(participant);
    };

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    };
  }, [room, attachTrack, detachTrack]);

  // Auto-join last room
  useEffect(() => {
    if (user.last_room_id && rooms.length > 0 && !currentRoom) {
      const lastRoom = rooms.find((r) => r.id === user.last_room_id);
      if (lastRoom) {
        handleJoinRoom(lastRoom.id);
      }
    }
  }, [user.last_room_id, rooms]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoinRoom = useCallback(
    async (roomId: number) => {
      setError(null);
      try {
        disconnect();
        const res = await api.joinRoom(roomId);
        setCurrentRoom(res.room);
        const connection: RoomConnection = {
          wsUrl: res.wsUrl,
          token: res.token,
          e2eeKey: res.e2eeKey,
        };
        await connect(connection);
      } catch (err) {
        const msg = err instanceof api.ApiError ? err.message : 'Failed to join room';
        setError(msg);
      }
    },
    [connect, disconnect],
  );

  const handleCreateRoom = useCallback(async () => {
    const name = prompt('Room name:');
    if (!name) return;
    try {
      const { room: newRoom } = await api.createRoom(name);
      // SSE will push the update, but also join immediately
      handleJoinRoom(newRoom.id);
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : 'Failed to create room';
      setError(msg);
    }
  }, [handleJoinRoom]);

  const isMuted = localParticipant ? !localParticipant.isMicrophoneEnabled : true;
  const isCameraOn = localParticipant ? localParticipant.isCameraEnabled : false;

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white flex">
      {/* Left sidebar — Rooms */}
      <aside className="w-60 bg-white dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <h2 className="text-lg font-bold">disTokoloshe</h2>
          <button
            onClick={() => setThemeState(toggleTheme())}
            className="text-zinc-400 hover:text-zinc-200 text-sm"
            title="Toggle theme"
          >
            {theme === 'dark' ? '\u2600' : '\u263E'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold uppercase text-zinc-500">Rooms</span>
            <button
              onClick={handleCreateRoom}
              className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
              title="Create room"
            >
              +
            </button>
          </div>

          {rooms.map((r) => (
            <div key={r.id} className="mb-1">
              <button
                onClick={() => handleJoinRoom(r.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  currentRoom?.id === r.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${
                    currentRoom?.id === r.id
                      ? 'bg-indigo-500 text-white'
                      : 'bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  {getRoomInitials(r.name)}
                </span>
                <span className="truncate">{r.name}</span>
              </button>
              {/* Connected members */}
              {roomMembers[r.id] && roomMembers[r.id].length > 0 && (
                <div className="ml-5 pl-4 border-l border-zinc-300 dark:border-zinc-600 mt-0.5">
                  {roomMembers[r.id].map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                      <span className="truncate">{m.display_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* User bar */}
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {user.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.display_name}</p>
              <p className="text-xs text-zinc-500 truncate">@{user.username}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            title="Logout"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 flex items-center px-6 border-b border-zinc-200 dark:border-zinc-700 bg-white/50 dark:bg-zinc-800/50 shrink-0">
          {currentRoom ? (
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                {getRoomInitials(currentRoom.name)}
              </span>
              <span className="font-semibold">{currentRoom.name}</span>
              <span className="text-xs text-zinc-500">
                {connectionState === ConnectionState.Connected
                  ? `${remoteParticipants.length + 1} participant${remoteParticipants.length !== 0 ? 's' : ''}`
                  : connectionState}
              </span>
            </div>
          ) : (
            <span className="text-zinc-500">Select a room to join</span>
          )}
        </header>

        {/* Participant area */}
        <div className="flex-1 p-6 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Screen shares */}
          {connectionState === ConnectionState.Connected && screenShares.length > 0 && (
            <div className="mb-4">
              {/* Layout controls */}
              {screenShares.length > 1 && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-zinc-500">{screenShares.length} screen shares</span>
                  <button
                    onClick={() => setShareViewMode('spotlight')}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      shareViewMode === 'spotlight'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    Spotlight
                  </button>
                  <button
                    onClick={() => setShareViewMode('grid')}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      shareViewMode === 'grid'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    Grid
                  </button>
                </div>
              )}

              {/* Spotlight mode (or single share) */}
              {(shareViewMode === 'spotlight' || screenShares.length === 1) ? (
                <>
                  <ScreenShareView
                    publication={screenShares[effectiveSpotlight].publication}
                    participantName={
                      screenShares[effectiveSpotlight].participant.name ||
                      screenShares[effectiveSpotlight].participant.identity
                    }
                  />
                  {/* Thumbnails for other shares */}
                  {screenShares.length > 1 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                      {screenShares.map((ss, idx) => (
                        <button
                          key={ss.participant.identity}
                          onClick={() => setSpotlightIndex(idx)}
                          className={`w-40 shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                            idx === effectiveSpotlight ? 'border-indigo-500' : 'border-zinc-700 hover:border-zinc-500'
                          }`}
                        >
                          <ScreenShareView
                            publication={ss.publication}
                            participantName={ss.participant.name || ss.participant.identity}
                            compact
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* Grid mode */
                <div className={`grid gap-2 ${
                  screenShares.length === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'
                }`}>
                  {screenShares.map((ss) => (
                    <ScreenShareView
                      key={ss.participant.identity}
                      publication={ss.publication}
                      participantName={ss.participant.name || ss.participant.identity}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {connectionState === ConnectionState.Connected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Local participant */}
              {localParticipant && (
                <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 ring-2 ring-indigo-500/30">
                  <div className="aspect-video bg-zinc-200 dark:bg-zinc-700 rounded-lg mb-3 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-2xl font-bold text-white">
                      {(localParticipant.name || localParticipant.identity).charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">
                      {localParticipant.name || localParticipant.identity} (You)
                    </span>
                    <span className="text-xs">{isMuted ? '\u{1F507}' : '\u{1F3A4}'}</span>
                  </div>
                </div>
              )}

              {/* Remote participants */}
              {remoteParticipants.map((p) => (
                <div
                  key={p.identity}
                  className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="aspect-video bg-zinc-200 dark:bg-zinc-700 rounded-lg mb-3 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-zinc-500 flex items-center justify-center text-2xl font-bold text-white">
                      {(p.name || p.identity).charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">
                      {p.name || p.identity}
                    </span>
                    <span className="text-xs">
                      {p.isMicrophoneEnabled ? '\u{1F3A4}' : '\u{1F507}'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {connectionState === ConnectionState.Connecting && (
            <div className="flex items-center justify-center h-64">
              <p className="text-zinc-500">Connecting...</p>
            </div>
          )}

          {connectionState === ConnectionState.Disconnected && !currentRoom && (
            <div className="flex items-center justify-center h-64">
              <p className="text-zinc-500">Select a room from the sidebar to get started</p>
            </div>
          )}
        </div>

        {/* Control bar */}
        {connectionState === ConnectionState.Connected && room && (
          <div className="h-16 flex items-center justify-center gap-3 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-6 shrink-0">
            <button
              onClick={() => room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isMuted
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600'
              }`}
            >
              {isMuted ? '\u{1F507} Unmute' : '\u{1F3A4} Mute'}
            </button>

            <button
              onClick={() => room.localParticipant.setCameraEnabled(!isCameraOn)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isCameraOn
                  ? 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
              }`}
            >
              {isCameraOn ? '\u{1F4F7} Cam Off' : '\u{1F4F7} Cam On'}
            </button>

            {/* Screen share with quality picker */}
            <div className="relative">
              <button
                onClick={() => {
                  if (isSharing) {
                    stopScreenShare();
                  } else {
                    setShowQualityMenu(!showQualityMenu);
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isSharing
                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                }`}
              >
                {isSharing
                  ? `${'\u{1F5B5}'} Stop (${shareQuality.charAt(0).toUpperCase() + shareQuality.slice(1)})`
                  : `${'\u{1F5B5}'} Share`}
              </button>
              {showQualityMenu && !isSharing && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1 min-w-[180px] z-50">
                  {(Object.entries(QUALITY_PRESETS) as [ShareQuality, (typeof QUALITY_PRESETS)[ShareQuality]][]).map(
                    ([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => {
                          setShowQualityMenu(false);
                          startScreenShare(key);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors ${
                          shareQuality === key
                            ? 'text-indigo-500 dark:text-indigo-400 font-medium'
                            : 'text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ),
                  )}
                  <div className="border-t border-zinc-200 dark:border-zinc-600 mx-2 my-1" />
                  <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-600" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={shareAudio}
                      onChange={(e) => setShareAudio(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    Share audio
                  </label>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowVolumes(!showVolumes)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
              title="Volume controls"
            >
              {'\u{1F50A}'} Volumes
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
            >
              {'\u2699'} Settings
            </button>

          </div>
        )}

        {/* Volume panel (slide-up) */}
        {showVolumes && connectionState === ConnectionState.Connected && (
          <div className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase text-zinc-500">Volume Controls</span>
              <button
                onClick={() => setShowVolumes(false)}
                className="text-zinc-400 hover:text-zinc-200 text-sm"
              >
                &times;
              </button>
            </div>
            {remoteParticipants.length === 0 ? (
              <p className="text-xs text-zinc-500 py-1">No other participants</p>
            ) : (
              remoteParticipants.map((p) => (
                <VolumeSlider
                  key={p.identity}
                  identity={p.identity}
                  displayName={p.name || p.identity}
                  volume={getVolume(p.identity)}
                  onChange={(v) => setVolume(p.identity, v)}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Right sidebar — User list */}
      <UserList users={users} currentUserId={user.id} />

      {/* Self screen share preview */}
      {isSharing && localScreenShare && (
        <div className="fixed bottom-20 right-56 w-72 z-40 shadow-2xl rounded-xl overflow-hidden">
          <ScreenShareView publication={localScreenShare} participantName="You" compact />
        </div>
      )}

      {/* Device settings modal */}
      {showSettings && room && (
        <DeviceSettings room={room} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
