import { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectionState, Track, RoomEvent } from 'livekit-client';
import type { RemoteTrackPublication, RemoteParticipant, TrackPublication } from 'livekit-client';
import { useLiveKitRoom, type RoomConnection } from '../hooks/useLiveKitRoom';
import { useAudioMixer } from '../hooks/useAudioMixer';
import { useScreenShare, QUALITY_PRESETS, type ShareQuality } from '../hooks/useScreenShare';
import { useEvents } from '../hooks/useEvents';
import { DeviceSettings } from '../components/DeviceSettings';
import { VolumeSlider } from '../components/VolumeSlider';
import { ScreenShareView } from '../components/ScreenShareView';
import { VideoTrackView } from '../components/VideoTrackView';
import { UserList } from '../components/UserList';
import { getRoomInitials, toggleTheme, getTheme } from '../lib/utils';
import * as api from '../lib/api';

interface RoomPageProps {
  user: api.User;
  onLogout: () => void;
}

const DURATION_OPTIONS = [
  { label: '1 min', secs: 60 },
  { label: '5 min', secs: 300 },
  { label: '15 min', secs: 900 },
  { label: '30 min', secs: 1800 },
];

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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

  // Vote state
  const [activeVote, setActiveVote] = useState<(api.Vote & { yesCount: number; noCount: number }) | null>(null);
  const [myBallot, setMyBallot] = useState<boolean | null>(null);
  const [voteCountdown, setVoteCountdown] = useState(0);
  const [showDurationPicker, setShowDurationPicker] = useState<number | null>(null);
  const [voteResult, setVoteResult] = useState<{ passed: boolean; targetDisplayName: string } | null>(null);

  // Punishment state
  const [activePunishment, setActivePunishment] = useState<api.Punishment | null>(null);
  const [punishmentCountdown, setPunishmentCountdown] = useState(0);
  const [punishmentChecked, setPunishmentChecked] = useState(false);

  // Jailed users (for room creator lift UI)
  const [jailedUsers, setJailedUsers] = useState<Array<{
    punishmentId: number; userId: number; displayName: string;
  }>>([]);

  // Whisper state
  const [whisperChain, setWhisperChain] = useState<api.ChainEntry[]>([]);
  const [isWhispersMode, setIsWhispersMode] = useState(false);

  const {
    room,
    localParticipant,
    remoteParticipants,
    activeSpeakers,
    connectionState,
    connect,
    disconnect,
  } = useLiveKitRoom();

  const { attachTrack, detachTrack, setVolume, getVolume, setMuted, isMuted } = useAudioMixer();
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(new Set());
  const {
    isSharing,
    shareQuality,
    shareAudio,
    setShareAudio,
    startScreenShare,
    stopScreenShare,
  } = useScreenShare(room);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [spotlight, setSpotlight] = useState<{ identity: string; source: 'screen_share' | 'camera' } | null>(null);

  // Responsive sidebar state
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  // Ref for handleJoinRoom so SSE handlers can access latest version
  const handleJoinRoomRef = useRef<(roomId: number) => Promise<void>>();


  // Local screen share track for self-preview
  const localScreenShare: TrackPublication | undefined = isSharing && room
    ? Array.from(room.localParticipant.trackPublications.values()).find(
        (pub) => pub.source === Track.Source.ScreenShare && pub.track,
      )
    : undefined;



  // Filter rooms: hide jail rooms unless it's our current room
  const visibleRooms = rooms.filter((r) => !r.is_jail || r.id === currentRoom?.id);

  // Find my whisper source
  const myChainEntry = whisperChain.find((e) => e.userId === user.id);
  const whisperSource = isWhispersMode && myChainEntry && whisperChain.length > 1
    ? whisperChain.find((e) => e.position === (myChainEntry.position - 1 + whisperChain.length) % whisperChain.length)
    : null;

  // Load initial data
  useEffect(() => {
    api.listRooms().then(({ rooms }) => setRooms(rooms)).catch(() => {});
    api.listUsers().then(({ users }) => setUsers(users)).catch(() => {});
    api.listRoomMembers().then(({ members }) => {
      const parsed: Record<number, api.RoomMember[]> = {};
      for (const [k, v] of Object.entries(members)) parsed[Number(k)] = v;
      setRoomMembers(parsed);
    }).catch(() => {});
    // Check for active punishments
    api.getActivePunishments().then(({ punishments }) => {
      if (punishments.length > 0) {
        setActivePunishment(punishments[0]);
      }
      setPunishmentChecked(true);
    }).catch(() => setPunishmentChecked(true));
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
        for (const rid of Object.keys(next)) {
          next[Number(rid)] = next[Number(rid)].filter((m) => m.id !== joinUser.id);
          if (next[Number(rid)].length === 0) delete next[Number(rid)];
        }
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
    'vote:started': (data) => {
      const { vote } = data as { vote: api.Vote };
      if (currentRoom && vote.sourceRoomId === currentRoom.id) {
        setActiveVote({ ...vote, yesCount: 1, noCount: 0 });
        setMyBallot(vote.initiatedBy.id === user.id ? true : null);
        setVoteResult(null);
      }
    },
    'vote:ballot_cast': (data) => {
      const { voteId, yesCount, noCount } = data as {
        voteId: number; sourceRoomId: number; yesCount: number; noCount: number; eligibleCount: number;
      };
      setActiveVote((prev) => {
        if (!prev || prev.id !== voteId) return prev;
        return { ...prev, yesCount, noCount };
      });
    },
    'vote:resolved': (data) => {
      const resolved = data as {
        voteId: number; passed: boolean; targetDisplayName: string;
        yesCount: number; noCount: number; eligibleCount: number;
        targetUserId: number; targetUsername: string; sourceRoomId: number;
      };
      setActiveVote((prev) => {
        if (prev?.id === resolved.voteId) {
          setVoteResult({ passed: resolved.passed, targetDisplayName: resolved.targetDisplayName });
          setTimeout(() => setVoteResult(null), 4000);
          return null;
        }
        return prev;
      });
      setMyBallot(null);
    },
    'punishment:started': (data) => {
      const { punishment, jailConnection } = data as {
        punishment: {
          id: number; targetUserId: number; targetUsername: string; targetDisplayName: string;
          sourceRoomId: number; sourceRoomName: string;
          jailRoomId: number; jailRoomName: string;
          durationSecs: number; expiresAt: string;
        };
        jailConnection: {
          token: string; e2eeKey: string;
          room: { id: number; name: string; type: string };
          wsUrl: string;
        };
      };
      // Track jailed user for room creator lift UI
      if (currentRoom && punishment.sourceRoomId === currentRoom.id) {
        setJailedUsers((prev) => [
          ...prev.filter((j) => j.userId !== punishment.targetUserId),
          { punishmentId: punishment.id, userId: punishment.targetUserId, displayName: punishment.targetDisplayName },
        ]);
      }
      if (punishment.targetUserId === user.id) {
        setActivePunishment({
          id: punishment.id,
          sourceRoomId: punishment.sourceRoomId,
          sourceRoomName: punishment.sourceRoomName,
          jailRoomId: punishment.jailRoomId,
          jailRoomName: punishment.jailRoomName,
          durationSecs: punishment.durationSecs,
          expiresAt: punishment.expiresAt,
        });
        setActiveVote(null);
        setMyBallot(null);
        setIsWhispersMode(false);
        setWhisperChain([]);
        disconnect().then(() => {
          const jailRoom: api.Room = {
            id: jailConnection.room.id,
            name: jailConnection.room.name,
            type: jailConnection.room.type as 'voice' | 'video',
            created_at: '',
            is_jail: 1,
            jail_source_room_id: punishment.sourceRoomId,
          };
          setCurrentRoom(jailRoom);
          setRooms((prev) => {
            if (prev.some((r) => r.id === jailRoom.id)) return prev;
            return [...prev, jailRoom];
          });
          connect({
            wsUrl: jailConnection.wsUrl,
            token: jailConnection.token,
            e2eeKey: jailConnection.e2eeKey,
          });
        });
      }
    },
    'punishment:expired': (data) => {
      const { punishmentId, targetUserId, sourceRoomId } = data as {
        punishmentId: number; targetUserId: number; sourceRoomId: number; sourceRoomName: string;
      };
      setJailedUsers((prev) => prev.filter((j) => j.punishmentId !== punishmentId));
      if (targetUserId === user.id) {
        setActivePunishment((prev) => {
          if (prev?.id === punishmentId) {
            handleJoinRoomRef.current?.(sourceRoomId);
            return null;
          }
          return prev;
        });
      }
    },
    'punishment:lifted': (data) => {
      const { punishmentId, targetUserId, sourceRoomId } = data as {
        punishmentId: number; targetUserId: number; sourceRoomId: number; sourceRoomName: string;
      };
      setJailedUsers((prev) => prev.filter((j) => j.punishmentId !== punishmentId));
      if (targetUserId === user.id) {
        setActivePunishment((prev) => {
          if (prev?.id === punishmentId) {
            handleJoinRoomRef.current?.(sourceRoomId);
            return null;
          }
          return prev;
        });
      }
    },
    'whispers:activated': (data) => {
      const { roomId, chain } = data as { roomId: number; chain: api.ChainEntry[] };
      if (currentRoom?.id === roomId) {
        setIsWhispersMode(true);
        setWhisperChain(chain);
      }
    },
    'whispers:deactivated': (data) => {
      const { roomId } = data as { roomId: number };
      if (currentRoom?.id === roomId) {
        setIsWhispersMode(false);
        setWhisperChain([]);
      }
    },
    'whispers:chain_updated': (data) => {
      const { roomId, chain } = data as { roomId: number; chain: api.ChainEntry[] };
      if (currentRoom?.id === roomId) {
        setWhisperChain(chain);
      }
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

  // Close duration picker on outside click
  useEffect(() => {
    if (showDurationPicker === null) return;
    const close = () => setShowDurationPicker(null);
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [showDurationPicker]);

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
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.kind === Track.Kind.Audio) {
        detachTrack(participant);
      }
    };

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    // Catch-up: attach audio tracks that were already subscribed before
    // this effect ran. This happens when tracks arrive during room.connect()
    // before React state updates trigger this useEffect.
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.isSubscribed && pub.track) {
          attachTrack(p, pub as RemoteTrackPublication);
        }
      }
    }

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    };
  }, [room, attachTrack, detachTrack]);

  // Vote countdown timer
  useEffect(() => {
    if (!activeVote) {
      setVoteCountdown(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((new Date(activeVote.expiresAt + 'Z').getTime() - Date.now()) / 1000));
      setVoteCountdown(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeVote]);

  // Punishment countdown timer
  useEffect(() => {
    if (!activePunishment) {
      setPunishmentCountdown(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((new Date(activePunishment.expiresAt + 'Z').getTime() - Date.now()) / 1000));
      setPunishmentCountdown(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activePunishment]);

  // Whisper audio muting — mute everyone except my source in the chain
  useEffect(() => {
    if (!isWhispersMode || whisperChain.length === 0) {
      // Whispers off: restore user mute preferences
      for (const p of remoteParticipants) {
        setMuted(p.identity, mutedUsers.has(p.identity));
      }
      return;
    }

    const myEntry = whisperChain.find((e) => e.userId === user.id);
    if (!myEntry) return;

    const sourcePos = (myEntry.position - 1 + whisperChain.length) % whisperChain.length;
    const sourceEntry = whisperChain.find((e) => e.position === sourcePos);

    for (const p of remoteParticipants) {
      if (p.identity === sourceEntry?.username) {
        // Source: respect user mute preference
        setMuted(p.identity, mutedUsers.has(p.identity));
      } else {
        // Non-source: always mute in whispers mode
        setMuted(p.identity, true);
      }
    }
  }, [isWhispersMode, whisperChain, remoteParticipants, user.id, setMuted, mutedUsers]);

  // Auto-join last room OR jail room (waits for punishment check)
  useEffect(() => {
    if (!punishmentChecked || rooms.length === 0 || currentRoom) return;

    if (activePunishment) {
      handleJoinRoom(activePunishment.jailRoomId);
    } else if (user.last_room_id) {
      const lastRoom = rooms.find((r) => r.id === user.last_room_id);
      if (lastRoom) {
        handleJoinRoom(lastRoom.id);
      }
    }
  }, [punishmentChecked, rooms]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoinRoom = useCallback(
    async (roomId: number) => {
      setError(null);
      setLeftSidebarOpen(false);
      setSpotlight(null);
      try {
        await disconnect();
        const res = await api.joinRoom(roomId);
        setCurrentRoom(res.room);
        // Handle whisper state for the new room
        if (res.room.mode === 'whispers') {
          setIsWhispersMode(true);
          api.getRoomChain(roomId).then(({ chain }) => setWhisperChain(chain)).catch(() => {});
        } else {
          setIsWhispersMode(false);
          setWhisperChain([]);
        }
        // Clear vote/punishment state
        setActiveVote(null);
        setMyBallot(null);
        setVoteResult(null);
        // Load active punishments for this room
        api.getRoomPunishments(roomId).then(({ punishments }) => {
          setJailedUsers(punishments.map((p) => ({
            punishmentId: p.id,
            userId: p.targetUserId,
            displayName: p.targetDisplayName,
          })));
        }).catch(() => setJailedUsers([]));

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
  handleJoinRoomRef.current = handleJoinRoom;

  const handleCreateRoom = useCallback(async () => {
    const name = prompt('Room name:');
    if (!name) return;
    try {
      const { room: newRoom } = await api.createRoom(name);
      handleJoinRoom(newRoom.id);
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : 'Failed to create room';
      setError(msg);
    }
  }, [handleJoinRoom]);

  const micMuted = localParticipant ? !localParticipant.isMicrophoneEnabled : true;
  const isCameraOn = localParticipant ? localParticipant.isCameraEnabled : false;

  // Auto-dismiss spotlight when the spotlighted track disappears
  useEffect(() => {
    if (!spotlight) return;
    const { identity, source } = spotlight;
    if (identity === localParticipant?.identity) {
      const hasPub = source === 'screen_share' ? !!localScreenShare : Array.from(localParticipant!.trackPublications.values()).some(
        (pub) => pub.source === Track.Source.Camera && pub.track,
      );
      if (!hasPub) setSpotlight(null);
      return;
    }
    const remote = remoteParticipants.find((p) => p.identity === identity);
    if (!remote) { setSpotlight(null); return; }
    const trackSource = source === 'screen_share' ? Track.Source.ScreenShare : Track.Source.Camera;
    const hasTrack = Array.from(remote.trackPublications.values()).some(
      (pub) => pub.source === trackSource && pub.isSubscribed && pub.track,
    );
    if (!hasTrack) setSpotlight(null);
  }, [spotlight, localParticipant, localScreenShare, remoteParticipants]);

  const toggleMuteUser = useCallback((identity: string) => {
    const muted = !isMuted(identity);
    setMuted(identity, muted);
    setMutedUsers((prev) => {
      const next = new Set(prev);
      if (muted) next.add(identity);
      else next.delete(identity);
      return next;
    });
  }, [isMuted, setMuted]);

  // Vote actions
  const handleStartVote = useCallback(async (targetUserId: number, durationSecs: number) => {
    try {
      setShowDurationPicker(null);
      await api.startVote(targetUserId, durationSecs);
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : 'Failed to start vote';
      setError(msg);
    }
  }, []);

  const handleCastBallot = useCallback(async (voteId: number, voteYes: boolean) => {
    try {
      await api.castBallot(voteId, voteYes);
      setMyBallot(voteYes);
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : 'Failed to cast vote';
      setError(msg);
    }
  }, []);

  // Toggle whispers mode (room creator only)
  const handleToggleWhispers = useCallback(async () => {
    if (!currentRoom) return;
    const newMode = isWhispersMode ? 'normal' : 'whispers';
    try {
      await api.setRoomMode(currentRoom.id, newMode);
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : 'Failed to change mode';
      setError(msg);
    }
  }, [currentRoom, isWhispersMode]);

  // Lift punishment (room creator only)
  const handleLiftPunishment = useCallback(async (punishmentId: number) => {
    try {
      await api.liftPunishment(punishmentId);
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : 'Failed to lift punishment';
      setError(msg);
    }
  }, []);

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white flex">
      {/* Left sidebar backdrop (mobile) */}
      {leftSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setLeftSidebarOpen(false)} />
      )}
      {/* Left sidebar — Rooms */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 bg-white dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 flex flex-col transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:z-auto ${leftSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="h-14 px-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between shrink-0">
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

          {visibleRooms.map((r) => (
            <div key={r.id} className="mb-1">
              <button
                onClick={() => {
                  if (activePunishment && r.id !== activePunishment.jailRoomId) {
                    setError('You are currently jailed and cannot switch rooms');
                    return;
                  }
                  handleJoinRoom(r.id);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  currentRoom?.id === r.id
                    ? r.is_jail ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${
                    currentRoom?.id === r.id
                      ? r.is_jail ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'
                      : r.is_jail
                        ? 'bg-red-600/30 text-red-400'
                        : 'bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  {r.is_jail ? '!' : getRoomInitials(r.name)}
                </span>
                <span className="truncate">{r.name}</span>
              </button>
              {/* Connected members */}
              {roomMembers[r.id] && roomMembers[r.id].length > 0 && (
                <div className="ml-5 pl-4 border-l border-zinc-300 dark:border-zinc-600 mt-0.5">
                  {roomMembers[r.id].map((m) => {
                    const memberSpeaking = activeSpeakers.includes(m.username);
                    const memberMuted = mutedUsers.has(m.username);
                    const isMe = m.id === user.id;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center gap-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400 group"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                          memberSpeaking && !memberMuted ? 'bg-blue-400 shadow-[0_0_4px_rgba(96,165,250,0.8)]' : 'bg-green-500'
                        }`} />
                        <span className="truncate flex-1">{m.display_name}</span>
                        {!isMe && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleMuteUser(m.username); }}
                            className={`md:opacity-0 md:group-hover:opacity-100 transition-opacity text-[10px] px-1 rounded ${
                              memberMuted
                                ? 'text-red-400 md:opacity-100'
                                : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                            title={memberMuted ? 'Unmute' : 'Mute'}
                          >
                            {memberMuted ? '\u{1F507}' : '\u{1F50A}'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* User bar */}
        <div className="h-16 px-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between shrink-0">
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
        <header className="h-14 flex items-center px-3 md:px-6 border-b border-zinc-200 dark:border-zinc-700 bg-white/50 dark:bg-zinc-800/50 shrink-0">
          {/* Left sidebar toggle — mobile only */}
          <button
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className="mr-2 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 md:hidden shrink-0"
            title="Toggle rooms"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {currentRoom ? (
            <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
              <span className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold text-white shrink-0 ${
                currentRoom.is_jail ? 'bg-red-600' : 'bg-indigo-600'
              }`}>
                {currentRoom.is_jail ? '!' : getRoomInitials(currentRoom.name)}
              </span>
              <span className="font-semibold truncate">{currentRoom.name}</span>
              <span className="text-xs text-zinc-500">
                {connectionState === ConnectionState.Connected
                  ? `${remoteParticipants.length + 1} participant${remoteParticipants.length !== 0 ? 's' : ''}`
                  : connectionState}
              </span>
              {isWhispersMode && (
                <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                  Whispers{whisperSource ? ` \u2014 You hear: ${whisperSource.displayName}` : ''}
                </span>
              )}
              {/* Mode toggle — any room member */}
              {!currentRoom.is_jail && connectionState === ConnectionState.Connected && (
                <button
                  onClick={handleToggleWhispers}
                  className={`ml-auto text-xs px-2 py-1 rounded transition-colors ${
                    isWhispersMode
                      ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                  }`}
                  title={isWhispersMode ? 'Disable Chinese Whispers' : 'Enable Chinese Whispers'}
                >
                  {isWhispersMode ? 'Disable Whispers' : 'Enable Whispers'}
                </button>
              )}
            </div>
          ) : (
            <span className="text-zinc-500 flex-1">Select a room to join</span>
          )}

          {/* Right sidebar toggle — mobile only */}
          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            className="ml-2 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 md:hidden shrink-0"
            title="Toggle members"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </header>

        {/* Participant area */}
        <div className="flex-1 p-6 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm flex items-center">
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-300">&times;</button>
            </div>
          )}

          {/* Punishment banner */}
          {activePunishment && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-sm">
              <span className="text-red-300 font-semibold">Jailed from {activePunishment.sourceRoomName}!</span>
              <span className="text-red-400 ml-2">{formatCountdown(punishmentCountdown)} remaining</span>
            </div>
          )}

          {/* Jailed users — any room member can lift */}
          {jailedUsers.length > 0 && (
            <div className="mb-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-sm">
              <span className="text-orange-400 font-semibold text-xs uppercase">Jailed from this room</span>
              {jailedUsers.map((j) => (
                <div key={j.punishmentId} className="flex items-center justify-between mt-1">
                  <span className="text-orange-300">{j.displayName}</span>
                  <button
                    onClick={() => handleLiftPunishment(j.punishmentId)}
                    className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                  >
                    Lift
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Vote result toast */}
          {voteResult && (
            <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
              voteResult.passed
                ? 'bg-red-500/20 border border-red-500/50 text-red-300'
                : 'bg-green-500/20 border border-green-500/50 text-green-300'
            }`}>
              Vote {voteResult.passed ? 'passed' : 'failed'}: {voteResult.targetDisplayName}
              {voteResult.passed ? ' has been sent to jail!' : ' stays.'}
            </div>
          )}

          {/* Active vote banner */}
          {activeVote && connectionState === ConnectionState.Connected && (
            <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm">
                  <span className="text-amber-400 font-semibold">Vote to punish: </span>
                  <span className="text-amber-300">{activeVote.targetDisplayName}</span>
                  <span className="text-zinc-500 ml-2">({formatCountdown(activeVote.durationSecs)} punishment)</span>
                </div>
                <span className="text-xs text-amber-400 tabular-nums">{formatCountdown(voteCountdown)} left</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 bg-zinc-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${activeVote.eligibleCount > 0 ? (activeVote.yesCount / activeVote.eligibleCount) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-400 whitespace-nowrap">
                    {activeVote.yesCount} yes / {activeVote.noCount} no / {activeVote.eligibleCount} eligible
                  </span>
                </div>
                {activeVote.targetUserId !== user.id && myBallot === null && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCastBallot(activeVote.id, true)}
                      className="px-3 py-1 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      Yes, Punish
                    </button>
                    <button
                      onClick={() => handleCastBallot(activeVote.id, false)}
                      className="px-3 py-1 text-xs rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                    >
                      No
                    </button>
                  </div>
                )}
                {myBallot !== null && (
                  <span className="text-xs text-zinc-500">Voted {myBallot ? 'Yes' : 'No'}</span>
                )}
                {activeVote.targetUserId === user.id && (
                  <span className="text-xs text-red-400">You are being voted on!</span>
                )}
              </div>
            </div>
          )}

          {/* Spotlighted view */}
          {spotlight && (() => {
            const { identity, source } = spotlight;
            const isLocal = identity === localParticipant?.identity;
            const remote = !isLocal ? remoteParticipants.find((p) => p.identity === identity) : null;
            const name = isLocal ? 'You' : (remote?.name || remote?.identity || identity);

            // Helper to find a track by source
            const findPub = (src: 'screen_share' | 'camera') => {
              if (src === 'screen_share') {
                if (isLocal) return localScreenShare || null;
                if (!remote) return null;
                return Array.from(remote.trackPublications.values()).find(
                  (pub) => pub.source === Track.Source.ScreenShare && pub.isSubscribed && pub.track,
                ) || null;
              }
              if (isLocal && localParticipant) {
                return Array.from(localParticipant.trackPublications.values()).find(
                  (pub) => pub.source === Track.Source.Camera && pub.track,
                ) || null;
              }
              if (remote) {
                return Array.from(remote.trackPublications.values()).find(
                  (pub) => pub.source === Track.Source.Camera && pub.isSubscribed && pub.track,
                ) || null;
              }
              return null;
            };

            const mainPub = findPub(source);
            const altSource = source === 'screen_share' ? 'camera' as const : 'screen_share' as const;
            const altPub = findPub(altSource);

            if (!mainPub) return null;
            return (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-500">
                    {name}&apos;s {source === 'screen_share' ? 'screen share' : 'camera'}
                  </span>
                  <button
                    onClick={() => setSpotlight(null)}
                    className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="relative">
                  {source === 'screen_share' ? (
                    <ScreenShareView publication={mainPub} participantName={name} />
                  ) : (
                    <div className="bg-black rounded-xl overflow-hidden">
                      <VideoTrackView publication={mainPub} mirror={isLocal} fit="contain" className="max-h-[70vh]" />
                    </div>
                  )}
                  {/* PIP of alternate source — click to swap */}
                  {altPub && (
                    <button
                      onClick={() => setSpotlight({ identity, source: altSource })}
                      className="absolute bottom-3 right-3 w-40 h-24 rounded-lg overflow-hidden border-2 border-zinc-500 hover:border-indigo-500 transition-colors shadow-lg bg-black z-10"
                      title={`Switch to ${altSource === 'screen_share' ? 'screen share' : 'camera'}`}
                    >
                      <VideoTrackView
                        publication={altPub}
                        mirror={isLocal && altSource === 'camera'}
                        fit={altSource === 'screen_share' ? 'contain' : 'cover'}
                      />
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {connectionState === ConnectionState.Connected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Local participant */}
              {localParticipant && (() => {
                const localSpeaking = activeSpeakers.includes(localParticipant.identity);
                const localCameraPub = Array.from(localParticipant.trackPublications.values()).find(
                  (pub) => pub.source === Track.Source.Camera && pub.track,
                );
                const hasScreenShare = !!localScreenShare;
                return (
                  <div className={`bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 ring-2 transition-shadow ${
                    localSpeaking ? 'ring-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.5)]' : 'ring-indigo-500/30'
                  }`}>
                    {/* Main video area: camera > screen share > avatar */}
                    <div
                      className={`aspect-video bg-zinc-200 dark:bg-zinc-700 rounded-lg mb-3 flex items-center justify-center overflow-hidden ${
                        hasScreenShare && !localCameraPub ? 'cursor-pointer ring-1 ring-zinc-600 hover:ring-indigo-500 transition-all' : ''
                      }`}
                      onClick={hasScreenShare && !localCameraPub ? () => setSpotlight({ identity: localParticipant.identity, source: 'screen_share' }) : undefined}
                    >
                      {localCameraPub ? (
                        <VideoTrackView publication={localCameraPub} mirror />
                      ) : hasScreenShare ? (
                        <VideoTrackView publication={localScreenShare!} fit="contain" />
                      ) : (
                        <div className={`w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-2xl font-bold text-white transition-shadow ${
                          localSpeaking ? 'shadow-[0_0_16px_rgba(96,165,250,0.6)]' : ''
                        }`}>
                          {(localParticipant.name || localParticipant.identity).charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    {/* Screen share thumbnail — only shown when camera is ON (otherwise it's in the main area) */}
                    {hasScreenShare && localCameraPub && (
                      <button
                        onClick={() => setSpotlight({ identity: localParticipant.identity, source: 'screen_share' })}
                        className="w-full rounded-lg overflow-hidden border-2 transition-colors mb-3 border-zinc-600 hover:border-indigo-500 bg-black"
                      >
                        <div className="aspect-video flex items-center justify-center">
                          <VideoTrackView publication={localScreenShare!} fit="contain" />
                        </div>
                      </button>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">
                        {localParticipant.name || localParticipant.identity} (You)
                      </span>
                      <span className="text-xs">{micMuted ? '\u{1F507}' : '\u{1F3A4}'}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Remote participants */}
              {remoteParticipants.map((p) => {
                const userMuted = mutedUsers.has(p.identity);
                const speaking = activeSpeakers.includes(p.identity);
                const memberEntry = currentRoom ? roomMembers[currentRoom.id]?.find((m) => m.username === p.identity) : null;
                const isMyWhisperSource = whisperSource?.username === p.identity;
                const whisperDimmed = isWhispersMode && !isMyWhisperSource;
                const cameraPub = Array.from(p.trackPublications.values()).find(
                  (pub) => pub.source === Track.Source.Camera && pub.isSubscribed && pub.track,
                );
                const screenSharePub = Array.from(p.trackPublications.values()).find(
                  (pub) => pub.source === Track.Source.ScreenShare && pub.isSubscribed && pub.track,
                );

                return (
                  <div
                    key={p.identity}
                    className={`group bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 ring-2 transition-all ${
                      speaking && !userMuted && !whisperDimmed ? 'ring-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.5)]' : 'ring-transparent'
                    } ${whisperDimmed ? 'opacity-40' : ''}`}
                  >
                    {/* Main video area: camera > screen share > avatar */}
                    <div
                      className={`aspect-video bg-zinc-200 dark:bg-zinc-700 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden ${
                        screenSharePub && !cameraPub ? 'cursor-pointer ring-1 ring-zinc-600 hover:ring-indigo-500 transition-all' : ''
                      }`}
                      onClick={screenSharePub && !cameraPub ? () => setSpotlight({ identity: p.identity, source: 'screen_share' }) : undefined}
                    >
                      {cameraPub ? (
                        <VideoTrackView publication={cameraPub} />
                      ) : screenSharePub ? (
                        <VideoTrackView publication={screenSharePub} fit="contain" />
                      ) : (
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white transition-shadow ${
                          isMyWhisperSource ? 'bg-purple-600' : 'bg-zinc-500'
                        } ${speaking && !userMuted && !whisperDimmed ? 'shadow-[0_0_16px_rgba(96,165,250,0.6)]' : ''}`}>
                          {(p.name || p.identity).charAt(0).toUpperCase()}
                        </div>
                      )}
                      {isMyWhisperSource && (
                        <span className="absolute top-1 right-1 text-[10px] bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded z-10">
                          Your source
                        </span>
                      )}
                    </div>
                    {/* Screen share thumbnail — only shown when camera is ON */}
                    {screenSharePub && cameraPub && (
                      <button
                        onClick={() => setSpotlight({ identity: p.identity, source: 'screen_share' })}
                        className="w-full rounded-lg overflow-hidden border-2 transition-colors mb-3 border-zinc-600 hover:border-indigo-500 bg-black"
                      >
                        <div className="aspect-video flex items-center justify-center">
                          <VideoTrackView publication={screenSharePub} fit="contain" />
                        </div>
                      </button>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">
                        {p.name || p.identity}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {!activeVote && !currentRoom?.is_jail && memberEntry && (
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowDurationPicker(showDurationPicker === memberEntry.id ? null : memberEntry.id);
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                              title="Vote to punish"
                            >
                              Vote
                            </button>
                            {showDurationPicker === memberEntry.id && (
                              <div className="absolute bottom-full mb-1 right-0 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1 min-w-[140px] z-50">
                                <div className="px-2 py-1 text-[10px] text-zinc-500 uppercase">Punishment</div>
                                {DURATION_OPTIONS.map((opt) => (
                                  <button
                                    key={opt.secs}
                                    onClick={() => handleStartVote(memberEntry.id, opt.secs)}
                                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors"
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => toggleMuteUser(p.identity)}
                          className={`text-sm px-2 py-1 rounded-md transition-colors ${
                            userMuted
                              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                              : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                          }`}
                          title={userMuted ? 'Unmute (local)' : 'Mute (local)'}
                        >
                          {userMuted ? '\u{1F507}' : '\u{1F50A}'}
                        </button>
                        <span className="text-xs">
                          {p.isMicrophoneEnabled ? '\u{1F3A4}' : '\u{1F507}'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
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
          <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 md:px-6 py-2 shrink-0">
            <button
              onClick={() => room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled)}
              className={`px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                micMuted
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600'
              }`}
            >
              {micMuted ? '\u{1F507}' : '\u{1F3A4}'}<span className="hidden sm:inline ml-1">{micMuted ? 'Unmute' : 'Mute'}</span>
            </button>

            <button
              onClick={() => room.localParticipant.setCameraEnabled(!isCameraOn)}
              className={`px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isCameraOn
                  ? 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
              }`}
            >
              {'\u{1F4F7}'}<span className="hidden sm:inline ml-1">{isCameraOn ? 'Cam Off' : 'Cam On'}</span>
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
                className={`px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isSharing
                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                }`}
              >
                {'\u{1F5B5}'}<span className="hidden sm:inline ml-1">{isSharing ? `Stop (${shareQuality.charAt(0).toUpperCase() + shareQuality.slice(1)})` : 'Share'}</span>
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
              className="px-3 md:px-4 py-2 rounded-lg text-sm font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
              title="Volume controls"
            >
              {'\u{1F50A}'}<span className="hidden sm:inline ml-1">Volumes</span>
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="px-3 md:px-4 py-2 rounded-lg text-sm font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
            >
              {'\u2699'}<span className="hidden sm:inline ml-1">Settings</span>
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
      <UserList users={users} currentUserId={user.id} open={rightSidebarOpen} onClose={() => setRightSidebarOpen(false)} />

      {/* Device settings modal */}
      {showSettings && room && (
        <DeviceSettings room={room} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
