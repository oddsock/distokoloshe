import { useState, useEffect, useCallback, useRef, type MouseEvent, type ReactNode } from 'react';
import { ConnectionState, Track, RoomEvent, VideoQuality } from 'livekit-client';
import type { RemoteTrackPublication, RemoteParticipant, TrackPublication } from 'livekit-client';
import { useLiveKitRoom, type RoomConnection } from '../hooks/useLiveKitRoom';
import { useAudioMixer } from '../hooks/useAudioMixer';
import { useScreenShare, QUALITY_PRESETS, type ShareQuality } from '../hooks/useScreenShare';
import { useEvents } from '../hooks/useEvents';
import { SettingsDialog } from '../components/SettingsDialog';
import { VolumeSlider } from '../components/VolumeSlider';
import { ParticipantTile, TileAction } from '../components/ParticipantTile';
import { PinnedStage, MAX_PINS, type Pin, type PinSource, type StagePane } from '../components/PinnedStage';
import { TheaterLayout } from '../components/TheaterLayout';
import type { ChatLine } from '../components/ChatBubbles';
import { ChatPanel, type ChatEntry } from '../components/ChatPanel';
import { ControlBar } from '../components/ControlBar';
import { VoteCard } from '../components/VoteCard';
import { Toasts } from '../components/Toasts';
import { RoomRail } from '../components/RoomRail';
import { StageHeader, type JailedUser } from '../components/StageHeader';
import { SidePanel, type PanelTab } from '../components/SidePanel';
import type { ServerLocation } from '../components/SignalStrength';
import { PeopleList } from '../components/PeopleList';
import { TooltipLayer } from '../components/TooltipLayer';
import { Floating } from '../components/Floating';
import { Soundboard } from '../components/Soundboard';
import { MusicControls } from '../components/MusicControls';
import { PipePanel } from '../components/PipePanel';
import { usePipePlayer } from '../hooks/usePipePlayer';
import { useSoundboard } from '../hooks/useSoundboard';
import { useConnectionStats } from '../hooks/useConnectionStats';
import { useHotkeys } from '../hooks/useHotkeys';
import { useMutedMicDetector } from '../hooks/useMutedMicDetector';
import { useSoundbiteRecorder } from '../hooks/useSoundbiteRecorder';
import { useNoiseCancellation } from '../hooks/useNoiseCancellation';
import { useAutoUpdate } from '../hooks/useAutoUpdate';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useElementSize } from '../hooks/useElementSize';
import { useToasts, type Toast } from '../hooks/useToasts';
import { useFullscreen } from '../hooks/useFullscreen';
import { toggleTheme, getTheme, parseParticipantMetadata } from '../lib/utils';
import { layoutGrid } from '../lib/gridLayout';
import * as api from '../lib/api';
import { playSound } from '../lib/sounds';
import { Mic, MicOff, EarOff, Volume2, VolumeX, Scissors, RefreshCw, Ellipsis, Gavel, DoorOpen, UserPlus, AudioLines, Monitor } from 'lucide-react';

const PANEL_PREF_KEY = 'distokoloshe_side_panel';

function readPanelPref(): boolean {
  try {
    return localStorage.getItem(PANEL_PREF_KEY) !== 'closed';
  } catch {
    return true;
  }
}

/** The room everyone falls back to: the oldest non-jail room (General on a fresh install). */
function defaultRoom(rooms: api.Room[]): api.Room | undefined {
  return rooms.filter((r) => !r.is_jail).sort((a, b) => a.id - b.id)[0];
}

/** Room membership with `member` moved into `roomId` (out of whichever room they were in). */
function withMemberIn(
  members: Record<number, api.RoomMember[]>, member: api.RoomMember, roomId: number,
): Record<number, api.RoomMember[]> {
  const next: Record<number, api.RoomMember[]> = {};
  for (const [rid, list] of Object.entries(members)) {
    const rest = list.filter((m) => m.id !== member.id);
    if (rest.length > 0) next[Number(rid)] = rest;
  }
  next[roomId] = [...(next[roomId] ?? []), member];
  return next;
}

interface RoomPageProps {
  user: api.User;
  onLogout: () => void;
  /** Server rejected our token mid-session; defaults to onLogout. */
  onSessionExpired?: () => void;
}

const DURATION_OPTIONS = [
  { label: '1 min', secs: 60 },
  { label: '5 min', secs: 300 },
  { label: '15 min', secs: 900 },
  { label: '30 min', secs: 1800 },
];

/** Music room radio bot + any non-Music ephemeral pipe bot. Used to
 *  suppress soundbite capture, human-only UI chrome, etc. */
function isMusicOrPipeBot(identity: string): boolean {
  return identity === '__music-bot__' || identity.startsWith('__pipe-');
}

/** Pipe bot publishes the current track title as JSON in its LK metadata
 *  (`{"pipeTitle": "…"}`). Null when absent or malformed. */
function getPipeTitle(metadata?: string | null): string | null {
  const title = parseParticipantMetadata(metadata).pipeTitle;
  return typeof title === 'string' && title.length > 0 ? title : null;
}

/** All floating popovers anchored to the control bar / tiles. Only one can be
 *  open at a time; any document click outside closes it. */
type Popover =
  | 'soundboard' | 'music' | 'pipe' | 'quality' | 'stopShare'
  | { durationPickerFor: number } | { volumeFor: string } | { tileMenuFor: string };

export function RoomPage({ user, onLogout, onSessionExpired }: RoomPageProps) {
  const [rooms, setRooms] = useState<api.Room[]>([]);
  const [users, setUsers] = useState<api.UserListItem[]>([]);
  const [roomMembers, setRoomMembers] = useState<Record<number, api.RoomMember[]>>({});
  const [currentRoom, setCurrentRoom] = useState<api.Room | null>(null);
  // Errors, joins, soundboard plays, vote results, jail news and connection states
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const showError = useCallback((msg: string) => { pushToast({ tone: 'error', text: msg }); }, [pushToast]);
  const [openPopover, setOpenPopover] = useState<Popover | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Buttons that popovers anchor to
  const ctlRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [theme, setThemeState] = useState<'dark' | 'light'>(getTheme);

  // Vote state
  const [activeVote, setActiveVote] = useState<(api.Vote & { yesCount: number; noCount: number }) | null>(null);
  const [myBallot, setMyBallot] = useState<boolean | null>(null);

  // Punishment state
  const [activePunishment, setActivePunishment] = useState<api.Punishment | null>(null);
  const [punishmentChecked, setPunishmentChecked] = useState(false);

  // People jailed from the room I'm in (header pill → vote to release)
  const [jailedUsers, setJailedUsers] = useState<JailedUser[]>([]);

  // Whisper state
  const [whisperChain, setWhisperChain] = useState<api.ChainEntry[]>([]);
  const [isWhispersMode, setIsWhispersMode] = useState(false);

  const {
    room,
    localParticipant,
    remoteParticipants,
    activeSpeakers,
    connectionState,
    e2eeEnabled,
    connect,
    disconnect,
  } = useLiveKitRoom();

  const { attachTrack, detachTrack, setVolume, getVolume, setMuted, isMuted, setTrackMuted, isTrackMuted, deafened, setDeafened } = useAudioMixer();
  const pipe = usePipePlayer();
  const { startRecording, stopRecording, captureSoundbite, captureAllSoundbites } = useSoundbiteRecorder();
  const { enabled: ncEnabled, setEnabled: setNcEnabled, engine: ncEngine, setEngine: setNcEngine, supported: ncSupported } = useNoiseCancellation(room);
  const autoUpdate = useAutoUpdate();
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(new Set());
  const [mutedStreamAudio, setMutedStreamAudio] = useState<Set<string>>(new Set());
  const {
    isSharing,
    shareQuality,
    startScreenShare,
    stopScreenShare,
  } = useScreenShare(room);
  const { clips, playingId, previewingId, volume: sbVolume, setVolume: setSbVolume, playClip, stopPlaying, previewClip, stopPreview, uploadClip, deleteClip, onClipCreated, onClipDeleted } = useSoundboard(room);
  const [soundboardPlaying, setSoundboardPlaying] = useState<{ username: string; clipName: string } | null>(null);
  const soundboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chat. Tile bubbles: each participant's recent lines, each expiring after 15 s.
  // History for the Chat tab: everything since joining this room — client-side only,
  // cleared on room switch. Images in it show as expired once the server has dropped them.
  const [bubbleLines, setBubbleLines] = useState<Map<string, ChatLine[]>>(new Map());
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const chatIdRef = useRef(0);
  const chatTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const isSafari = /Safari\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
  const [safariWarnDismissed, setSafariWarnDismissed] = useState(() => localStorage.getItem('safariCodecWarnDismissed') === '1');
  // Pinned videos, in order: none = grid, one = theater, 2–4 = multiview
  const [pins, setPins] = useState<Pin[]>([]);
  // Shares showing when you went back to the grid (track sids) — auto-pin leaves them be
  const declinedSharesRef = useRef(new Set<string>());
  // Shares already noticed, so "X started sharing" is said once (track sids)
  const seenSharesRef = useRef(new Set<string>());
  const connectedAtRef = useRef(0);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageFullscreen = useFullscreen(stageEl);
  const [audioTrackVersion, setAudioTrackVersion] = useState(0);
  const [videoTrackVersion, setVideoTrackVersion] = useState(0);

  // Connection stats (RTT / jitter)
  const connectionStats = useConnectionStats(room);
  const [serverLocation, setServerLocation] = useState<ServerLocation | null>(null);

  // Global hotkeys
  const handleToggleMute = useCallback(() => {
    if (!room) return;
    const willMute = room.localParticipant.isMicrophoneEnabled;
    room.localParticipant.setMicrophoneEnabled(!willMute);
    playSound(willMute ? 'mute' : 'unmute');
  }, [room]);
  const handleToggleDeafen = useCallback(() => {
    setDeafened(!deafened);
  }, [deafened, setDeafened]);
  const handleCaptureSoundbites = useCallback(() => {
    const participants = remoteParticipants
      .filter((p) => !isMusicOrPipeBot(p.identity))
      .map((p) => ({ identity: p.identity, displayName: p.name || p.identity }));
    captureAllSoundbites(participants);
  }, [remoteParticipants, captureAllSoundbites]);
  const { bindings: hotkeyBindings, setBindings: setHotkeyBindings } = useHotkeys({
    onToggleMute: handleToggleMute,
    onToggleDeafen: handleToggleDeafen,
    onCaptureSoundbites: handleCaptureSoundbites,
    enabled: connectionState === ConnectionState.Connected,
  });

  // Mobile detection (JS-based, responds to orientation changes)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Rooms drawer (phones)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  // The grid's available space (measured independently of its content) sizes the tiles
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const gridSize = useElementSize(gridEl);
  // Side panel (People): a column beside the stage from 1080px, an overlay drawer below.
  // Opens by default where it fits; the choice is remembered for wide windows.
  const panelOverlay = !useMediaQuery('(min-width: 1080px)');
  const [panelOpen, setPanelOpen] = useState(() => !panelOverlay && readPanelPref());
  useEffect(() => {
    // Shrinking below the threshold would suddenly cover the stage — close it; growing
    // back restores the saved preference.
    setPanelOpen(panelOverlay ? false : readPanelPref());
  }, [panelOverlay]);
  const [panelTab, setPanelTab] = useState<PanelTab>('people');
  const setPanelVisible = useCallback((open: boolean) => {
    setPanelOpen(open);
    if (!panelOverlay) {
      try { localStorage.setItem(PANEL_PREF_KEY, open ? 'open' : 'closed'); } catch { /* private mode */ }
    }
  }, [panelOverlay]);
  const showPanelTab = useCallback((tab: PanelTab) => {
    setPanelTab(tab);
    setPanelVisible(true);
  }, [setPanelVisible]);
  /** Header People button / bar Chat button: open that tab, or close if it's already showing */
  const togglePanelTab = useCallback((tab: PanelTab) => {
    if (panelOpen && panelTab === tab) setPanelVisible(false);
    else showPanelTab(tab);
  }, [panelOpen, panelTab, setPanelVisible, showPanelTab]);
  const chatVisible = panelOpen && panelTab === 'chat';
  useEffect(() => {
    if (chatVisible) setChatUnread(0);
  }, [chatVisible]);

  // Ref for handleJoinRoom so SSE handlers can access latest version
  const handleJoinRoomRef = useRef<(roomId: number) => Promise<void>>();
  // Counter to detect stale join attempts (prevents error flash on quick room switch)
  const joinIdRef = useRef(0);


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

  // Signal intentional leave on tab close/navigation so server skips grace period.
  // beforeunload: reliable on desktop browsers. pagehide: reliable on mobile Safari (swipe-close).
  // In Tauri, the Rust on_window_event handler sends the leave signal natively on close,
  // so we skip these listeners (Tauri invoke is blocked during unload anyway).
  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window) return;
    const sendLeave = () => api.sendLeaveBeacon();
    window.addEventListener('beforeunload', sendLeave);
    window.addEventListener('pagehide', sendLeave);
    return () => {
      window.removeEventListener('beforeunload', sendLeave);
      window.removeEventListener('pagehide', sendLeave);
    };
  }, []);

  // Where the server is (SERVER_CITY, or estimated from its IP) — once on mount
  useEffect(() => {
    fetch(`${api.getBaseUrl()}/api/server-info`).then((r) => r.json()).then((d: { city?: string | null; estimated?: boolean }) => {
      if (d.city) setServerLocation({ city: d.city, estimated: !!d.estimated });
    }).catch(() => {});
  }, []);

  // Rooms, users and room membership — on mount, and again after an SSE drop
  // (events sent while we were disconnected are lost, so these would go stale).
  const loadLists = useCallback(() => {
    api.listRooms().then(({ rooms }) => setRooms(rooms)).catch(() => {});
    api.listUsers().then(({ users }) => setUsers(users)).catch(() => {});
    api.listRoomMembers().then(({ members }) => {
      const parsed: Record<number, api.RoomMember[]> = {};
      for (const [k, v] of Object.entries(members)) parsed[Number(k)] = v;
      setRoomMembers(parsed);
    }).catch(() => {});
  }, []);

  // Chat belongs to the room you're in: switching rooms clears bubbles and history
  const clearChat = useCallback(() => {
    chatTimersRef.current.forEach(clearTimeout);
    chatTimersRef.current.clear();
    setBubbleLines(new Map());
    setChatHistory([]);
    setChatUnread(0);
  }, []);
  useEffect(() => clearChat, [clearChat]);
  useEffect(() => {
    clearChat();
  }, [currentRoom?.id, clearChat]);

  // Load initial data
  useEffect(() => {
    loadLists();
    // Check for active punishments
    api.getActivePunishments().then(({ punishments }) => {
      if (punishments.length > 0) {
        setActivePunishment(punishments[0]);
      }
      setPunishmentChecked(true);
    }).catch(() => setPunishmentChecked(true));
  }, [loadLists]);

  // Auto-rejoin when LiveKit drops (e.g. "createOffer with closed peer connection")
  // Only triggers after we were Connected and then dropped — not during intentional joins.
  const rejoinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rejoinAttemptsRef = useRef(0);
  const wasConnectedRef = useRef(false);
  const MAX_REJOIN_ATTEMPTS = 3;
  useEffect(() => {
    if (connectionState === ConnectionState.Connected) {
      wasConnectedRef.current = true;
      rejoinAttemptsRef.current = 0;
      if (rejoinTimerRef.current) {
        clearTimeout(rejoinTimerRef.current);
        rejoinTimerRef.current = null;
      }
      return;
    }
    if (connectionState !== ConnectionState.Disconnected) {
      if (rejoinTimerRef.current) {
        clearTimeout(rejoinTimerRef.current);
        rejoinTimerRef.current = null;
      }
      return;
    }
    // Only auto-rejoin if we previously had a successful connection that dropped
    if (!wasConnectedRef.current || !currentRoom) return;
    if (rejoinAttemptsRef.current >= MAX_REJOIN_ATTEMPTS) return;
    wasConnectedRef.current = false;
    const attempt = ++rejoinAttemptsRef.current;
    const delay = Math.min(2000 * attempt, 8000);
    rejoinTimerRef.current = setTimeout(async () => {
      rejoinTimerRef.current = null;
      try {
        const { token, wsUrl, e2eeKey } = await api.joinRoom(currentRoom.id);
        await connect({ wsUrl, token, e2eeKey });
      } catch (err) {
        console.warn(`Auto-rejoin attempt ${attempt}/${MAX_REJOIN_ATTEMPTS} failed:`, err);
      }
    }, delay);
    return () => {
      if (rejoinTimerRef.current) {
        clearTimeout(rejoinTimerRef.current);
        rejoinTimerRef.current = null;
      }
    };
  }, [currentRoom, connectionState, connect]);

  // Re-sync room membership when SSE reconnects after a drop (an API restart forgets
  // which room everyone is in)
  const handleSSEReconnect = useCallback(async () => {
    if (
      currentRoom && (
        connectionState === ConnectionState.Disconnected ||
        connectionState === ConnectionState.Reconnecting
      )
    ) {
      // LiveKit dropped while SSE was down — re-join the room
      try {
        const { token, wsUrl, e2eeKey } = await api.joinRoom(currentRoom.id);
        await connect({ wsUrl, token, e2eeKey });
      } catch (err) {
        console.warn('LiveKit reconnect after SSE reconnect failed:', err);
      }
    } else if (currentRoom) {
      // Connected — or still connecting, or only LiveKit's signal link is reconnecting
      // (media keeps flowing): just tell the server which room we're in
      try {
        await api.syncRoom(currentRoom.id);
      } catch (err) {
        console.warn('Room sync after SSE reconnect failed:', err);
      }
    }
    // After our own membership is re-established, refetch what we may have missed
    loadLists();
    // A jail sentence may have ended while we were disconnected (expiry event missed)
    api.getActivePunishments().then(({ punishments }) => {
      setActivePunishment((prev) => {
        if (prev && !punishments.some((p) => p.id === prev.id)) {
          handleJoinRoomRef.current?.(prev.sourceRoomId);
          return null;
        }
        return prev;
      });
    }).catch(() => {});
  }, [currentRoom, connectionState, connect, loadLists]);

  // LiveKit's signal link goes through the same proxy as the API, so when it had to
  // reconnect the API may have restarted too and forgotten our room. Re-sync once LiveKit
  // is back (harmless if nothing was lost — the server only announces joins it didn't know).
  const prevConnectionStateRef = useRef(connectionState);
  useEffect(() => {
    const prev = prevConnectionStateRef.current;
    prevConnectionStateRef.current = connectionState;
    if (!currentRoom || connectionState !== ConnectionState.Connected) return;
    if (prev !== ConnectionState.Reconnecting && prev !== ConnectionState.SignalReconnecting) return;
    api.syncRoom(currentRoom.id)
      .then(() => loadLists())
      .catch((err) => console.warn('Room sync after LiveKit reconnect failed:', err));
  }, [connectionState, currentRoom, loadLists]);

  const handlePunishmentEnded =(data: unknown, lifted: boolean) => {
    const { punishmentId, targetUserId, sourceRoomId, sourceRoomName } = data as {
      punishmentId: number; targetUserId: number; sourceRoomId: number; sourceRoomName: string;
    };
    const ended = jailedUsers.find((j) => j.punishmentId === punishmentId);
    setJailedUsers((prev) => prev.filter((j) => j.punishmentId !== punishmentId));
    if (targetUserId === user.id) {
      if (activePunishment?.id !== punishmentId) return;
      pushToast({
        tone: 'success',
        icon: <DoorOpen size={14} />,
        text: lifted ? `${sourceRoomName} voted to release you` : `Your jail time is up — back to ${sourceRoomName}`,
      });
      setActivePunishment(null);
      handleJoinRoomRef.current?.(sourceRoomId);
    } else if (ended && !lifted) {
      // (A release by vote already got its "Vote passed" toast)
      pushToast({ tone: 'info', icon: <DoorOpen size={14} />, text: `${ended.displayName}'s jail time is up` });
    }
  };

  // SSE events for real-time updates
  useEvents({ handlers: {
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
      if (currentRoom?.id === deletedRoom.id) {
        const fallback = defaultRoom(rooms.filter((r) => r.id !== deletedRoom.id));
        if (fallback) {
          pushToast({ tone: 'info', text: `${deletedRoom.name} was deleted — you've been moved to ${fallback.name}` });
          handleJoinRoomRef.current?.(fallback.id);
        }
      }
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
      setRoomMembers((prev) => withMemberIn(prev, joinUser, roomId));
      if (currentRoom && roomId === currentRoom.id && joinUser.id !== user.id) {
        playSound('join');
        pushToast({ tone: 'info', icon: <UserPlus size={14} />, text: `${joinUser.display_name} joined` });
      }
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
      if (currentRoom && roomId === currentRoom.id && leaveUser.id !== user.id) {
        playSound('leave');
      }
    },
    'vote:started': (data) => {
      const { vote } = data as { vote: api.Vote };
      if (currentRoom && vote.sourceRoomId === currentRoom.id) {
        setActiveVote({ ...vote, yesCount: 1, noCount: 0 });
        setMyBallot(vote.initiatedBy.id === user.id ? true : null);
      } else if (vote.kind === 'lift' && vote.targetUserId === user.id) {
        // I'm in jail; the room I was jailed from is deciding
        const from = rooms.find((r) => r.id === vote.sourceRoomId)?.name ?? 'Your room';
        pushToast({ tone: 'info', icon: <DoorOpen size={14} />, text: `${from} is voting on releasing you` });
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
      const r = data as {
        voteId: number; kind?: 'jail' | 'lift'; passed: boolean; voided?: boolean;
        targetDisplayName?: string; targetUserId: number; sourceRoomId: number;
      };
      const lift = r.kind === 'lift';
      if (lift && r.targetUserId === user.id) {
        // Sent to me in jail. A pass arrives as punishment:lifted and moves me back.
        if (!r.passed && !r.voided) pushToast({ tone: 'warn', text: "The vote to release you didn't pass" });
        return;
      }
      if (!currentRoom || r.sourceRoomId !== currentRoom.id) return;
      setActiveVote((prev) => (prev?.id === r.voteId ? null : prev));
      setMyBallot(null);
      // Voided: the jail time ran out mid-vote — punishment:expired says so
      if (r.voided) return;
      const me = r.targetUserId === user.id;
      const name = r.targetDisplayName ?? 'They';
      if (lift) {
        pushToast(r.passed
          ? { tone: 'success', icon: <DoorOpen size={14} />, text: `Vote passed — ${name} is out of jail` }
          : { tone: 'info', text: `Vote failed — ${name} stays in jail` });
      } else if (!(me && r.passed)) { // being jailed gets its own toast
        pushToast(r.passed
          ? { tone: 'warn', icon: <Gavel size={14} />, text: `Vote passed — ${name} is going to jail` }
          : { tone: 'info', text: `Vote failed — ${me ? 'you stay' : `${name} stays`}` });
      }
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
      if (currentRoom && punishment.sourceRoomId === currentRoom.id) {
        setJailedUsers((prev) => [
          ...prev.filter((j) => j.userId !== punishment.targetUserId),
          {
            punishmentId: punishment.id,
            userId: punishment.targetUserId,
            displayName: punishment.targetDisplayName,
            expiresAt: punishment.expiresAt,
          },
        ]);
      }
      if (punishment.targetUserId === user.id) {
        const mins = Math.round(punishment.durationSecs / 60);
        pushToast({
          tone: 'error',
          icon: <Gavel size={14} />,
          text: `You were voted into jail from ${punishment.sourceRoomName} for ${mins} minute${mins === 1 ? '' : 's'}`,
        });
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
    // Jail over — its time ran out (expired) or the room voted to release them (lifted)
    'punishment:expired': (data) => handlePunishmentEnded(data, false),
    'punishment:lifted': (data) => handlePunishmentEnded(data, true),
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
    'soundboard:created': (data) => {
      const { clip } = data as { clip: api.SoundboardClip };
      onClipCreated(clip);
    },
    'soundboard:deleted': (data) => {
      const { clipId } = data as { clipId: number };
      onClipDeleted(clipId);
    },
    'soundboard:playing': (data) => {
      const { user: sbUser, clipName, durationMs } = data as {
        user: { id: number; username: string; display_name: string }; clipName: string; durationMs?: number;
      };
      setSoundboardPlaying({ username: sbUser.username, clipName });
      if (sbUser.id !== user.id) {
        pushToast({ tone: 'info', icon: <AudioLines size={14} />, text: `${sbUser.display_name} played “${clipName}”` });
      }
      if (soundboardTimerRef.current) clearTimeout(soundboardTimerRef.current);
      soundboardTimerRef.current = setTimeout(() => setSoundboardPlaying(null), durationMs || 10_000);
    },
    'chat:message': (data) => {
      const { user: chatUser, text, imageId, ts } = data as {
        user: { id: number; username: string; display_name: string }; text?: string; imageId?: string; ts?: number;
      };
      const identity = chatUser.username;
      const imageUrl = imageId ? `${api.getBaseUrl()}/api/chat/image/${imageId}` : undefined;
      const thumbUrl = imageUrl ? `${imageUrl}/thumb` : undefined;
      const line: ChatLine = { id: ++chatIdRef.current, text: text || undefined, imageUrl, thumbUrl };

      if (chatUser.id !== user.id) {
        playSound('chatMessage');
        if (!chatVisible) setChatUnread((n) => n + 1);
      }

      // Tile bubble, gone after 15 s
      setBubbleLines((prev) => new Map(prev).set(identity, [...(prev.get(identity) ?? []), line].slice(-10)));
      chatTimersRef.current.set(line.id, setTimeout(() => {
        chatTimersRef.current.delete(line.id);
        setBubbleLines((prev) => {
          const remaining = (prev.get(identity) ?? []).filter((l) => l.id !== line.id);
          const next = new Map(prev);
          if (remaining.length === 0) next.delete(identity);
          else next.set(identity, remaining);
          return next;
        });
      }, 15_000));

      // Chat tab history. The server deletes chat images 60 s after upload; we see the
      // message slightly later, so treat it as gone 55 s after it arrived.
      setChatHistory((prev) => [...prev, {
        ...line,
        userId: chatUser.id,
        displayName: chatUser.display_name,
        ts: ts ?? Date.now(),
        imageExpiresAt: imageUrl ? Date.now() + 55_000 : undefined,
      }].slice(-300));
    },
    'music:status': (data) => {
      setMusicStatus(data as api.MusicStatus);
    },
  }, onConnect: loadLists, onReconnect: handleSSEReconnect, onUnauthorized: onSessionExpired ?? onLogout });

  // Stop any active client-piped audio when the Room unmounts (logout, refresh).
  // The Tauri window-close handler covers app exit; this covers in-app teardown.
  // CRITICAL: depend on pipe.stop (stable useCallback ref), NOT pipe (new object
  // every render — would fire the cleanup on every re-render and kill the pipe).
  useEffect(() => {
    return () => {
      void pipe.stop();
    };
  }, [pipe.stop]);

  // Close the open popover on any outside click. Panels that must survive
  // inner clicks call stopPropagation themselves. The setTimeout defers the
  // listener so the click that opened the popover doesn't immediately close it.
  useEffect(() => {
    if (openPopover === null) return;
    const close = () => setOpenPopover(null);
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [openPopover]);

  // Music bot state — driven by SSE, no polling
  const hasMusicBot = remoteParticipants.some((p) => p.identity === '__music-bot__');
  const [musicStatus, setMusicStatus] = useState<api.MusicStatus | null>(null);
  useEffect(() => {
    if (!hasMusicBot) {
      setOpenPopover((p) => (p === 'music' ? null : p));
      setMusicStatus(null);
      return;
    }
    api.getMusicStatus().then(setMusicStatus).catch(() => {});
  }, [hasMusicBot]);
  const musicNowPlaying = musicStatus
    ? (musicStatus.paused ? `(Paused) ${musicStatus.nowPlaying || ''}` : musicStatus.nowPlaying)
    : null;
  const refreshMusicStatus = useCallback(() => {
    api.getMusicStatus().then(setMusicStatus).catch(() => {});
  }, []);

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
        if (!parseParticipantMetadata(participant.metadata).soundbiteOptOut) {
          startRecording(participant.identity, publication);
        }
        setAudioTrackVersion((v) => v + 1);
      }
      if (publication.kind === Track.Kind.Video) {
        setVideoTrackVersion((v) => v + 1);
      }
      if (publication.source === Track.Source.ScreenShare && publication.kind === Track.Kind.Video) {
        playSound('screenShare');
      }
    };

    const handleTrackUnsubscribed = (
      _track: unknown,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.kind === Track.Kind.Audio) {
        detachTrack(participant, publication.source ?? Track.Source.Microphone);
        // Only a mic unsubscribe ends the soundbite recording — a stream-audio
        // unsubscribe (user stops sharing) must not kill the mic ring buffer,
        // since recording only restarts on a mic TrackSubscribed event.
        if (publication.source === Track.Source.Microphone) {
          stopRecording(participant.identity);
        }
        setAudioTrackVersion((v) => v + 1);
      }
      if (publication.kind === Track.Kind.Video) {
        setVideoTrackVersion((v) => v + 1);
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
          if (!parseParticipantMetadata(p.metadata).soundbiteOptOut) {
            startRecording(p.identity, pub as RemoteTrackPublication);
          }
        }
      }
    }

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      for (const p of room.remoteParticipants.values()) {
        stopRecording(p.identity);
      }
    };
  }, [room, attachTrack, detachTrack, startRecording, stopRecording]);

  // Whisper audio muting — mute everyone except my source in the chain.
  // Also depends on audioTrackVersion so muting is re-applied after a new
  // audio track is subscribed (the audio node doesn't exist yet when the
  // participant first connects, only after TrackSubscribed fires).
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
      if (sourceEntry && p.identity === sourceEntry.username) {
        // Source: respect user mute preference
        setMuted(p.identity, mutedUsers.has(p.identity));
      } else {
        // Non-source (or sourceEntry missing): always mute in whispers mode
        setMuted(p.identity, true);
      }
    }
  }, [isWhispersMode, whisperChain, remoteParticipants, audioTrackVersion, user.id, setMuted, mutedUsers]);

  // Re-apply stream-audio mutes after tracks (re)subscribe — attachTrack
  // creates nodes unmuted, so a re-subscribed ScreenShareAudio track would
  // otherwise come back audible while the UI still shows it muted.
  useEffect(() => {
    for (const identity of mutedStreamAudio) {
      setTrackMuted(identity, Track.Source.ScreenShareAudio, true);
    }
  }, [audioTrackVersion, mutedStreamAudio, setTrackMuted]);

  // Auto-join last room OR jail room (waits for punishment check)
  useEffect(() => {
    if (!punishmentChecked || rooms.length === 0 || currentRoom) return;

    if (activePunishment) {
      handleJoinRoom(activePunishment.jailRoomId);
      return;
    }
    // You're always in a room: the last one, or the default if it's gone (or was a jail
    // room whose sentence has ended — then its source room).
    const lastRoom = user.last_room_id ? rooms.find((r) => r.id === user.last_room_id) : undefined;
    const target = lastRoom && !lastRoom.is_jail
      ? lastRoom
      : rooms.find((r) => r.id === lastRoom?.jail_source_room_id) ?? defaultRoom(rooms);
    if (target) handleJoinRoom(target.id);
  }, [punishmentChecked, rooms]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoinRoom = useCallback(
    async (roomId: number) => {
      const myJoinId = ++joinIdRef.current;
      setLeftSidebarOpen(false);
      setPins([]);
      try {
        await disconnect();
        if (joinIdRef.current !== myJoinId) return; // superseded by newer join
        const res = await api.joinRoom(roomId);
        if (joinIdRef.current !== myJoinId) return;
        setCurrentRoom(res.room);
        // List ourselves in the room now rather than waiting for our own room_join event,
        // which never arrives if the event stream wasn't open yet (often so on page load)
        setRoomMembers((prev) => withMemberIn(
          prev, { id: user.id, username: user.username, display_name: user.display_name }, res.room.id,
        ));
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
        // Load active punishments for this room
        api.getRoomPunishments(roomId).then(({ punishments }) => {
          setJailedUsers(punishments.map((p) => ({
            punishmentId: p.id,
            userId: p.targetUserId,
            displayName: p.targetDisplayName,
            expiresAt: p.expiresAt,
          })));
        }).catch(() => setJailedUsers([]));

        const connection: RoomConnection = {
          wsUrl: res.wsUrl,
          token: res.token,
          e2eeKey: res.e2eeKey,
        };
        await connect(connection);
        if (joinIdRef.current === myJoinId) playSound('connect');
      } catch (err) {
        if (joinIdRef.current !== myJoinId) return; // stale join, don't show error
        const roomName = rooms.find((r) => r.id === roomId)?.name;
        const base = err instanceof api.ApiError ? err.message : 'Failed to join room';
        showError(roomName ? `${base} (${roomName})` : base);
      }
    },
    [connect, disconnect, rooms, showError, user],
  );
  handleJoinRoomRef.current = handleJoinRoom;

  const handleCreateRoom = useCallback(async () => {
    const name = prompt('Room name:');
    if (!name) return;
    try {
      const { room: newRoom } = await api.createRoom(name);
      handleJoinRoom(newRoom.id);
    } catch (err) {
      showError(err instanceof api.ApiError ? err.message : 'Failed to create room');
    }
  }, [handleJoinRoom, showError]);

  const micMuted = localParticipant ? !localParticipant.isMicrophoneEnabled : true;
  const isCameraOn = localParticipant ? localParticipant.isCameraEnabled : false;
  const { showWarning: showMutedWarning, dismiss: dismissMutedWarning } = useMutedMicDetector(
    micMuted,
    connectionState === ConnectionState.Connected,
  );
  // State toasts: shown while the state lasts (keyed, so they never stack up)
  const dismissMutedRef = useRef(dismissMutedWarning);
  dismissMutedRef.current = dismissMutedWarning;
  useEffect(() => {
    if (!showMutedWarning) return;
    pushToast({
      key: 'muted-mic', tone: 'error', sticky: true, icon: <MicOff size={14} />,
      text: "You're muted — others can't hear you", onDismiss: () => dismissMutedRef.current(),
    });
    return () => dismissToast('muted-mic');
  }, [showMutedWarning, pushToast, dismissToast]);
  useEffect(() => {
    if (connectionState !== ConnectionState.Reconnecting && connectionState !== ConnectionState.SignalReconnecting) return;
    pushToast({
      key: 'reconnecting', tone: 'warn', sticky: true, icon: <RefreshCw size={14} className="animate-spin" />,
      text: 'Reconnecting… audio and video may be interrupted',
    });
    return () => dismissToast('reconnecting');
  }, [connectionState, pushToast, dismissToast]);

  /** Someone's live screen share or camera, exactly as their tile shows it (null if none). */
  const findVideoPub = (identity: string, source: PinSource): TrackPublication | null => {
    const isLocal = !!localParticipant && identity === localParticipant.identity;
    if (isLocal && source === 'screen_share') return localScreenShare ?? null;
    const pubs: TrackPublication[] = isLocal
      ? Array.from(localParticipant!.trackPublications.values())
      : Array.from(remoteParticipants.find((p) => p.identity === identity)?.trackPublications.values() ?? []);
    const trackSource = source === 'screen_share' ? Track.Source.ScreenShare : Track.Source.Camera;
    return pubs.find((pub) =>
      pub.source === trackSource && !!pub.track && (isLocal || pub.isSubscribed) && (source === 'screen_share' || !pub.isMuted),
    ) ?? null;
  };

  const samePin = (a: Pin, b: Pin) => a.identity === b.identity && a.source === b.source;

  // Drop panes whose video ended. (Runs after every render: cheap, and track changes don't
  // always change a dependency.)
  useEffect(() => {
    const live = pins.filter((pin) => findVideoPub(pin.identity, pin.source));
    if (live.length !== pins.length) setPins(live);
  });

  // Auto-pin: with nothing pinned, someone else's share takes the stage (its sound is left
  // as it is). Shares that were showing when you went back to the grid stay in the grid.
  useEffect(() => {
    if (pins.length > 0 || connectionState !== ConnectionState.Connected) return;
    for (const p of remoteParticipants) {
      const pub = findVideoPub(p.identity, 'screen_share');
      if (pub && !declinedSharesRef.current.has(pub.trackSid)) {
        setPins([{ identity: p.identity, source: 'screen_share' }]);
        return;
      }
    }
  });

  /** Add a pane (multiview); the stage holds four at most. */
  const addPin = (pin: Pin) => {
    if (pins.some((x) => samePin(x, pin))) return;
    if (pins.length >= MAX_PINS) {
      showError(`Up to ${MAX_PINS} on the stage at once — unpin one first`);
      return;
    }
    setPins([...pins, pin]);
  };
  // Toast actions run later — they call the newest addPin, not the one from when they were made
  const addPinRef = useRef(addPin);
  addPinRef.current = addPin;

  /** Back to the grid; every share showing now stays out of auto-pin. */
  const unpinAll = () => {
    for (const p of remoteParticipants) {
      const pub = findVideoPub(p.identity, 'screen_share');
      if (pub) declinedSharesRef.current.add(pub.trackSid);
    }
    setPins([]);
  };
  /** Close one pane; closing the last is going back to the grid. */
  const unpin = (pin: Pin) => {
    if (pins.length <= 1) unpinAll();
    else setPins(pins.filter((x) => !samePin(x, pin)));
  };
  /** Tile clicks replace the stage; the Pin button and Ctrl/⌘-click add a pane. */
  const pinFromTile = (identity: string) => (source: PinSource, add: boolean) => {
    const pin = { identity, source };
    if (add && pins.length > 0) addPin(pin);
    else setPins([pin]);
  };
  const pinLabel = pins.length === 0 ? 'Pin to stage'
    : pins.length >= MAX_PINS ? `Stage is full (${MAX_PINS})` : 'Add to stage (Ctrl/⌘-click)';

  // "X started sharing" while something else is on the stage: offer to view it or add it.
  // Shares already live when you connect (they arrive over the first seconds) don't count.
  useEffect(() => {
    if (connectionState === ConnectionState.Connected) connectedAtRef.current = Date.now();
  }, [connectionState]);
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) return;
    const settling = Date.now() - connectedAtRef.current < 3000;
    for (const p of remoteParticipants) {
      const pub = findVideoPub(p.identity, 'screen_share');
      if (!pub || seenSharesRef.current.has(pub.trackSid)) continue;
      seenSharesRef.current.add(pub.trackSid);
      const pin: Pin = { identity: p.identity, source: 'screen_share' };
      // An empty stage auto-pins it instead
      if (settling || pins.length === 0 || pins.some((x) => samePin(x, pin))) continue;
      pushToast({
        tone: 'info',
        icon: <Monitor size={14} />,
        text: `${p.name || p.identity} started sharing`,
        durationMs: 8000,
        actions: [
          { label: 'View', onClick: () => setPins([pin]) },
          ...(pins.length < MAX_PINS ? [{ label: 'Add to split', onClick: () => addPinRef.current(pin) }] : []),
        ],
      });
    }
  });

  // Locked stream quality turns adaptive stream off, so every video arrives at full size.
  // While something is pinned, ask for the small layer of everything that isn't.
  useEffect(() => {
    if (!room || room.options.adaptiveStream) return;
    for (const p of remoteParticipants) {
      for (const pub of p.trackPublications.values()) {
        if (pub.kind !== Track.Kind.Video || !pub.isSubscribed) continue;
        const source: PinSource | null = pub.source === Track.Source.ScreenShare ? 'screen_share'
          : pub.source === Track.Source.Camera ? 'camera' : null;
        if (!source) continue;
        const onStage = pins.length === 0 || pins.some((x) => x.identity === p.identity && x.source === source);
        pub.setVideoQuality(onStage ? VideoQuality.HIGH : VideoQuality.LOW);
      }
    }
  }, [room, remoteParticipants, pins, videoTrackVersion]);

  /** Pinnable videos in the order the layout buttons take them: shares (others' before
   *  yours), then cameras — current speakers first. */
  const stageCandidates = ((): Pin[] => {
    const remoteIds = remoteParticipants.map((p) => p.identity);
    const everyone = localParticipant ? [...remoteIds, localParticipant.identity] : remoteIds;
    const cameraOrder = [...new Set([...activeSpeakers.filter((id) => remoteIds.includes(id)), ...everyone])];
    return [
      ...everyone.filter((id) => findVideoPub(id, 'screen_share')).map((identity) => ({ identity, source: 'screen_share' as const })),
      ...cameraOrder.filter((id) => findVideoPub(id, 'camera')).map((identity) => ({ identity, source: 'camera' as const })),
    ];
  })();
  const setLayout = (layout: 'grid' | 'theater' | 'multiview') => {
    if (layout === 'grid') {
      if (pins.length > 0) unpinAll();
    } else if (layout === 'theater') {
      setPins(pins.length > 0 ? [pins[0]] : stageCandidates.slice(0, 1));
    } else {
      // Keep what's pinned and fill up with the next candidates
      const next = [...pins];
      for (const c of stageCandidates) {
        if (next.length >= MAX_PINS) break;
        if (!next.some((x) => samePin(x, c))) next.push(c);
      }
      setPins(next);
    }
  };

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

  const toggleStreamAudioMute = useCallback((identity: string) => {
    const muted = !mutedStreamAudio.has(identity);
    setTrackMuted(identity, Track.Source.ScreenShareAudio, muted);
    setMutedStreamAudio((prev) => {
      const next = new Set(prev);
      if (muted) next.add(identity);
      else next.delete(identity);
      return next;
    });
  }, [mutedStreamAudio, setTrackMuted]);

  // Vote actions
  const handleStartVote = useCallback(async (targetUserId: number, durationSecs: number) => {
    try {
      setOpenPopover(null);
      await api.startVote(targetUserId, durationSecs);
    } catch (err) {
      showError(err instanceof api.ApiError ? err.message : 'Failed to start vote');
    }
  }, [showError]);

  const handleStartLiftVote = useCallback(async (punishmentId: number) => {
    try {
      await api.startLiftVote(punishmentId);
    } catch (err) {
      showError(err instanceof api.ApiError ? err.message : 'Failed to start vote');
    }
  }, [showError]);

  const handleCastBallot = useCallback(async (voteId: number, voteYes: boolean) => {
    try {
      await api.castBallot(voteId, voteYes);
      setMyBallot(voteYes);
    } catch (err) {
      showError(err instanceof api.ApiError ? err.message : 'Failed to cast vote');
    }
  }, [showError]);

  // Toggle whispers mode (room creator only)
  const handleToggleWhispers = useCallback(async () => {
    if (!currentRoom) return;
    const newMode = isWhispersMode ? 'normal' : 'whispers';
    try {
      await api.setRoomMode(currentRoom.id, newMode);
    } catch (err) {
      showError(err instanceof api.ApiError ? err.message : 'Failed to change mode');
    }
  }, [currentRoom, isWhispersMode, showError]);

  const handleDeleteRoom = useCallback(async () => {
    if (!currentRoom) return;
    if (!window.confirm(`Delete "${currentRoom.name}"? Everyone in it will be moved to another room.`)) return;
    try {
      await api.deleteRoom(currentRoom.id);
    } catch (err) {
      showError(err instanceof api.ApiError ? err.message : 'Failed to delete room');
    }
  }, [currentRoom, showError]);

  // Release votes need someone to vote with and a free vote slot
  const roomHeadcount = currentRoom ? (roomMembers[currentRoom.id]?.length ?? 0) : 0;
  const releaseBlockedReason = activeVote
    ? 'A vote is already running in this room.'
    : roomHeadcount < 2 ? 'A vote needs at least 2 people in the room.' : null;

  // Who's audibly active / has their mic off, for the rail avatars and People panel
  const speakingUsernames = new Set(activeSpeakers.filter((id) => !mutedUsers.has(id)));
  if (soundboardPlaying && !mutedUsers.has(soundboardPlaying.username)) speakingUsernames.add(soundboardPlaying.username);
  const micOffUsernames = new Set(remoteParticipants.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity));
  if (localParticipant && micMuted) micOffUsernames.add(localParticipant.identity);

  // Tiles shrink to fit the stage; p-1 around the grid keeps speaking rings unclipped
  const tileCount = remoteParticipants.length + (localParticipant ? 1 : 0);
  const gridLayout = layoutGrid(tileCount, gridSize.width - 8, gridSize.height - 8, 12);
  const gridColumns = gridSize.width > 0
    ? `repeat(${gridLayout.columns}, ${gridLayout.tileWidth}px)`
    : `repeat(${Math.min(Math.max(tileCount, 1), 3)}, minmax(0, 1fr))`;
  const popoverIs = (kind: 'durationPickerFor' | 'volumeFor' | 'tileMenuFor', id: string | number) =>
    typeof openPopover === 'object' && openPopover !== null && kind in openPopover
    && (openPopover as Record<string, string | number>)[kind] === id;
  const setCtlRef = (key: string) => (el: HTMLButtonElement | null) => { ctlRefs.current[key] = el; };
  const tileMenuItem = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors';

  // ── Tiles: one builder each for you and for others, used by the grid and the filmstrip.
  // hideShare / hideCamera drop what's on the stage, so a pinned person's strip tile shows
  // their other video (or avatar) instead of the same picture twice.
  type TileOpts = { compact?: boolean; hideShare?: boolean; hideCamera?: boolean };

  const renderLocalTile = ({ compact, hideShare, hideCamera }: TileOpts = {}) => {
    if (!localParticipant) return null;
    const id = localParticipant.identity;
    return (
      <ParticipantTile
        displayName={localParticipant.name || id}
        isLocal
        speakingGlow={activeSpeakers.includes(id)}
        cameraPub={hideCamera ? null : findVideoPub(id, 'camera')}
        screenSharePub={hideShare ? null : localScreenShare}
        onPin={pinFromTile(id)}
        pinLabel={pinLabel}
        compact={compact}
        chatLines={bubbleLines.get(id) ?? []}
        chatColor="blue"
        onViewMessages={() => showPanelTab('chat')}
        status={
          <>
            {hideShare && <Monitor size={12} className="text-green-400 shrink-0" aria-label="Sharing screen" />}
            {deafened && <EarOff size={12} className="text-red-400 shrink-0" aria-label="Deafened" />}
            {micMuted ? <MicOff size={12} className="text-red-400 shrink-0" aria-label="Mic off" /> : <Mic size={12} className="shrink-0" />}
          </>
        }
      />
    );
  };

  const renderRemoteTile = (p: RemoteParticipant, { compact, hideShare, hideCamera }: TileOpts = {}) => {
    const name = p.name || p.identity;
    const isBot = isMusicOrPipeBot(p.identity);
    const userMuted = mutedUsers.has(p.identity);
    const speaking = activeSpeakers.includes(p.identity);
    const playingSB = soundboardPlaying?.username === p.identity;
    const memberEntry = currentRoom ? roomMembers[currentRoom.id]?.find((m) => m.username === p.identity) : null;
    const isMyWhisperSource = whisperSource?.username === p.identity;
    const whisperDimmed = isWhispersMode && !isMyWhisperSource;
    const soundbiteOptOut = !!parseParticipantMetadata(p.metadata).soundbiteOptOut;
    const cameraPub = hideCamera ? null : findVideoPub(p.identity, 'camera');
    const screenSharePub = hideShare ? null : findVideoPub(p.identity, 'screen_share');
    const hasStreamAudio = Array.from(p.trackPublications.values()).some(
      (pub) => pub.source === Track.Source.ScreenShareAudio && pub.isSubscribed && pub.track,
    );
    const streamAudioMuted = hasStreamAudio && mutedStreamAudio.has(p.identity);
    const botLabel = p.identity === '__music-bot__'
      ? musicNowPlaying
      : p.identity.startsWith('__pipe-')
        ? (getPipeTitle(p.metadata) ?? p.name ?? 'Streaming')
        : null;
    const canVote = !activeVote && !currentRoom?.is_jail && memberEntry != null;
    const volumeOpen = popoverIs('volumeFor', p.identity);
    const menuOpen = popoverIs('tileMenuFor', p.identity);
    const durationPickerOpen = memberEntry != null && popoverIs('durationPickerFor', memberEntry.id);
    const volKey = `vol-${p.identity}`;
    const moreKey = `more-${p.identity}`;

    return (
      <ParticipantTile
        key={p.identity}
        displayName={name}
        speakingGlow={(speaking || playingSB) && !userMuted && !whisperDimmed}
        dimmed={whisperDimmed}
        isMyWhisperSource={isMyWhisperSource}
        cameraPub={cameraPub}
        screenSharePub={screenSharePub}
        botLabel={botLabel}
        hasStreamAudio={hasStreamAudio}
        streamAudioMuted={streamAudioMuted}
        onToggleStreamAudio={() => toggleStreamAudioMute(p.identity)}
        onPin={pinFromTile(p.identity)}
        pinLabel={pinLabel}
        compact={compact}
        chatLines={bubbleLines.get(p.identity) ?? []}
        chatColor="green"
        onViewMessages={() => showPanelTab('chat')}
        nameSuffix={playingSB ? (
          <span className="text-[10px] text-amber-300 truncate shrink-0">🔊 {soundboardPlaying.clipName}</span>
        ) : undefined}
        status={
          <>
            {hideShare && <Monitor size={12} className="text-green-400 shrink-0" aria-label="Sharing screen" />}
            {userMuted && <VolumeX size={12} className="text-red-400 shrink-0" aria-label="Muted for you" />}
            {!isBot && (p.isMicrophoneEnabled
              ? <Mic size={12} className="shrink-0" />
              : <MicOff size={12} className="text-red-400 shrink-0" aria-label="Mic off" />)}
          </>
        }
        actionsVisible={volumeOpen || menuOpen || durationPickerOpen}
        actions={
          <>
            <TileAction
              ref={setCtlRef(volKey)}
              label={`Volume for ${name}`}
              onClick={() => setOpenPopover(volumeOpen ? null : { volumeFor: p.identity })}
            >
              <Volume2 size={14} />
            </TileAction>
            {!isBot && !soundbiteOptOut && (
              <TileAction label="Save soundbite (last 10 s)" onClick={() => captureSoundbite(p.identity, name)}>
                <Scissors size={14} />
              </TileAction>
            )}
            <TileAction
              ref={setCtlRef(moreKey)}
              label="More"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setOpenPopover(menuOpen || durationPickerOpen ? null : { tileMenuFor: p.identity })}
            >
              <Ellipsis size={14} />
            </TileAction>

            <Floating anchor={ctlRefs.current[volKey] ?? null} open={volumeOpen} placement="bottom" zClass="z-50">
              <div onClick={(e) => e.stopPropagation()} className="w-60 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg p-3">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200 mb-1 truncate">{name}</p>
                <VolumeSlider
                  identity={p.identity}
                  displayName={name}
                  volume={getVolume(p.identity)}
                  onChange={(v) => setVolume(p.identity, v)}
                  compact
                />
                <p className="text-[10px] text-zinc-500 mt-1">Only changes what you hear</p>
              </div>
            </Floating>
            <Floating anchor={ctlRefs.current[moreKey] ?? null} open={menuOpen} placement="bottom" zClass="z-50">
              <div role="menu" onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1 min-w-[170px]">
                <button role="menuitem" className={tileMenuItem} onClick={() => { toggleMuteUser(p.identity); setOpenPopover(null); }}>
                  {userMuted ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  {userMuted ? 'Unmute for me' : 'Mute for me'}
                </button>
                {canVote && (
                  <button
                    role="menuitem"
                    className={`${tileMenuItem} text-red-500 dark:text-red-400`}
                    onClick={() => setOpenPopover({ durationPickerFor: memberEntry!.id })}
                  >
                    <Gavel size={14} />Vote to jail…
                  </button>
                )}
              </div>
            </Floating>
            {memberEntry && (
              <Floating anchor={ctlRefs.current[moreKey] ?? null} open={durationPickerOpen} placement="bottom" zClass="z-50">
                <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1 min-w-[150px]">
                  <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase">Jail {name} for</div>
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
              </Floating>
            )}
          </>
        }
      />
    );
  };

  // ── Stage: what's pinned (one pane = theater, 2–4 = multiview), everyone in the filmstrip
  const dismissToastByUser = (t: Toast) => { t.onDismiss?.(); dismissToast(t.id); };
  const panes: StagePane[] = [];
  for (const pin of pins) {
    const publication = findVideoPub(pin.identity, pin.source);
    if (!publication) continue;
    const isLocalPin = pin.identity === localParticipant?.identity;
    const remote = isLocalPin ? undefined : remoteParticipants.find((p) => p.identity === pin.identity);
    const altPin: Pin = { identity: pin.identity, source: pin.source === 'screen_share' ? 'camera' : 'screen_share' };
    panes.push({
      key: `${pin.identity}:${pin.source}`,
      publication,
      source: pin.source,
      name: isLocalPin ? 'You' : (remote?.name || pin.identity),
      isLocal: isLocalPin,
      hasStreamAudio: !!remote && pin.source === 'screen_share' && Array.from(remote.trackPublications.values()).some(
        (pub) => pub.source === Track.Source.ScreenShareAudio && pub.isSubscribed && pub.track,
      ),
      streamAudioMuted: mutedStreamAudio.has(pin.identity),
      onToggleStreamAudio: () => toggleStreamAudioMute(pin.identity),
      onUnpin: () => unpin(pin),
      onSolo: pins.length > 1 ? () => setPins([pin]) : undefined,
      // One pane: the same person's other video sits in its corner to swap to
      altPublication: pins.length === 1 ? findVideoPub(altPin.identity, altPin.source) : null,
      onPinAlt: () => setPins([altPin]),
    });
  }

  let stage: { main: ReactNode; strip: Array<{ key: string; node: ReactNode }> } | null = null;
  if (panes.length > 0) {
    // Strip: pinned people first (their pinned sources hidden), then you, then everyone else
    const localId = localParticipant?.identity;
    const order = [...new Set([...pins.map((x) => x.identity), ...(localId ? [localId] : []), ...remoteParticipants.map((p) => p.identity)])];
    const strip: Array<{ key: string; node: ReactNode }> = [];
    for (const id of order) {
      const opts: TileOpts = {
        compact: true,
        hideShare: pins.some((x) => x.identity === id && x.source === 'screen_share'),
        hideCamera: pins.some((x) => x.identity === id && x.source === 'camera'),
      };
      if (id === localId) {
        strip.push({ key: 'local', node: renderLocalTile(opts) });
      } else {
        const rp = remoteParticipants.find((p) => p.identity === id);
        if (rp) strip.push({ key: id, node: renderRemoteTile(rp, opts) });
      }
    }
    const stop = (e: MouseEvent) => e.stopPropagation();
    stage = {
      strip,
      main: (
        <PinnedStage
          panes={panes}
          isFullscreen={stageFullscreen.isFullscreen}
          windowFullscreen={stageFullscreen.windowMode}
          onToggleFullscreen={stageFullscreen.toggle}
          rootRef={setStageEl}
          fullscreenOverlay={
            // Fullscreen hides the rest of the page — bring the toasts and the vote along
            <div onDoubleClick={stop}>
              <Toasts toasts={toasts} onDismiss={dismissToastByUser} topClass="top-3" />
              {activeVote && (
                <div className="absolute bottom-4 inset-x-4 z-30 flex justify-center pointer-events-none">
                  <VoteCard
                    vote={activeVote}
                    currentUserId={user.id}
                    myBallot={myBallot}
                    onBallot={(yes) => handleCastBallot(activeVote.id, yes)}
                  />
                </div>
              )}
            </div>
          }
        />
      ),
    };
  }

  return (
    <div className="h-screen overflow-hidden bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white flex">
      <TooltipLayer />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        room={connectionState === ConnectionState.Connected ? room : null}
        hotkeyBindings={hotkeyBindings}
        onHotkeyChange={setHotkeyBindings}
        noiseCancellation={{ enabled: ncEnabled, setEnabled: setNcEnabled, engine: ncEngine, setEngine: setNcEngine, supported: ncSupported }}
        autoUpdate={autoUpdate}
        theme={theme}
        onToggleTheme={() => setThemeState(toggleTheme())}
      />
      <RoomRail
        rooms={visibleRooms}
        currentRoomId={currentRoom?.id ?? null}
        roomMembers={roomMembers}
        speaking={speakingUsernames}
        user={user}
        theme={theme}
        onToggleTheme={() => setThemeState(toggleTheme())}
        onSelectRoom={(roomId) => {
          if (activePunishment && roomId !== activePunishment.jailRoomId) {
            showError('You are currently jailed and cannot switch rooms');
            return;
          }
          handleJoinRoom(roomId);
        }}
        onCreateRoom={handleCreateRoom}
        mobileOpen={leftSidebarOpen}
        onMobileClose={() => setLeftSidebarOpen(false)}
        connectionStats={connectionStats}
        serverLocation={serverLocation}
        connecting={connectionState === ConnectionState.Connecting || (connectionState === ConnectionState.Connected && connectionStats.rttMs === null)}
        connected={connectionState === ConnectionState.Connected}
        e2eeEnabled={e2eeEnabled}
        onLogout={onLogout}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main content */}
      <main className="relative flex-1 flex flex-col min-w-0 min-h-0">
        <StageHeader
          room={currentRoom}
          status={connectionState === ConnectionState.Connected
            ? `${remoteParticipants.length + 1} in room`
            : connectionState === ConnectionState.Connecting ? 'Connecting…'
              : connectionState === ConnectionState.Disconnected ? 'Disconnected' : 'Reconnecting…'}
          whispersActive={isWhispersMode}
          whisperSourceName={whisperSource?.displayName ?? null}
          canToggleWhispers={!!currentRoom && !currentRoom.is_jail && connectionState === ConnectionState.Connected}
          onToggleWhispers={handleToggleWhispers}
          canDeleteRoom={!!currentRoom && !currentRoom.is_jail && currentRoom.created_by === user.id}
          onDeleteRoom={handleDeleteRoom}
          jail={activePunishment && currentRoom?.is_jail
            ? { expiresAt: activePunishment.expiresAt, sourceRoomName: activePunishment.sourceRoomName }
            : null}
          jailed={currentRoom?.is_jail ? [] : jailedUsers}
          releaseBlockedReason={releaseBlockedReason}
          onVoteRelease={handleStartLiftVote}
          layout={connectionState === ConnectionState.Connected
            ? (panes.length === 0 ? 'grid' : panes.length === 1 ? 'theater' : 'multiview')
            : null}
          canTheater={stageCandidates.length > 0}
          canMultiview={stageCandidates.length > 1}
          onLayout={setLayout}
          canFullscreen={panes.length > 0}
          onFullscreen={stageFullscreen.toggle}
          onOpenRail={() => setLeftSidebarOpen(true)}
          panelOpen={panelOpen && panelTab === 'people'}
          onTogglePanel={() => togglePanelTab('people')}
        />

        {!stageFullscreen.isFullscreen && <Toasts toasts={toasts} onDismiss={dismissToastByUser} />}

        {/* Participant area */}
        <div className="flex-1 min-h-0 flex flex-col p-4 md:p-6 pb-24 overflow-y-auto">
          {connectionState === ConnectionState.Connected && (
            <div ref={setGridEl} className="relative flex-1 min-h-[200px]">
              {stage ? (
                <TheaterLayout width={gridSize.width} height={gridSize.height} main={stage.main} strip={stage.strip} />
              ) : (
                <div className="absolute inset-0 overflow-y-auto">
                  <div
                    className={`grid gap-3 justify-center p-1 ${gridLayout.scroll ? 'content-start' : 'h-full content-center'}`}
                    style={{ gridTemplateColumns: gridColumns }}
                  >
                    {renderLocalTile()}
                    {remoteParticipants.map((p) => renderRemoteTile(p))}
                  </div>
                </div>
              )}
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

        {/* Control bar (docked to the stage) + its popovers, anchored to its buttons */}
        {connectionState === ConnectionState.Connected && room && (() => {
          const showShare = !isMobile;
          const showPipe = pipe.available && !!currentRoom && !hasMusicBot;
          const anchorFor = (key: string) => ctlRefs.current[key] ?? null;
          const setRef = (key: string) => (el: HTMLButtonElement | null) => { ctlRefs.current[key] = el; };
          const toggle = (key: 'soundboard' | 'music' | 'pipe') =>
            setOpenPopover(openPopover === key ? null : key);
          const toggleShare = () => {
            if (isSharing) setOpenPopover(openPopover === 'stopShare' ? null : 'stopShare');
            else setOpenPopover(openPopover === 'quality' ? null : 'quality');
          };
          const toggleCamera = () => {
            room.localParticipant.setCameraEnabled(!isCameraOn);
            playSound(isCameraOn ? 'cameraOff' : 'cameraOn');
          };
          const shareTooltip = isSharing
            ? `Stop Sharing (${shareQuality.charAt(0).toUpperCase() + shareQuality.slice(1)})`
            : 'Share Screen';
          return (
            <>
              {/* Bottom dock: the running vote sits just above the control bar */}
              <div className="absolute bottom-4 inset-x-4 z-30 flex flex-col items-center gap-2 pointer-events-none">
                {activeVote && (
                  <VoteCard
                    vote={activeVote}
                    currentUserId={user.id}
                    myBallot={myBallot}
                    onBallot={(yes) => handleCastBallot(activeVote.id, yes)}
                  />
                )}
                <ControlBar
                  micMuted={micMuted}
                  onToggleMute={handleToggleMute}
                  cameraOn={isCameraOn}
                  onToggleCamera={toggleCamera}
                  deafened={deafened}
                  onToggleDeafen={handleToggleDeafen}
                  showShare={showShare}
                  sharing={isSharing}
                  shareTooltip={shareTooltip}
                  onShare={toggleShare}
                  showMusic={hasMusicBot}
                  onMusic={() => toggle('music')}
                  showPipe={showPipe}
                  onPipe={() => toggle('pipe')}
                  onSoundboard={() => toggle('soundboard')}
                  onSettings={() => { setOpenPopover(null); setSettingsOpen(true); }}
                  chatOpen={chatVisible}
                  chatUnread={chatUnread}
                  onChat={() => togglePanelTab('chat')}
                  buttonRef={setRef}
                />
              </div>

              {/* Share: stop confirmation / quality picker */}
              <Floating anchor={anchorFor('share')} open={openPopover === 'stopShare' && isSharing} zClass="z-50">
                <div className="bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg p-3 min-w-[160px]">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 text-center">Stop sharing?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setOpenPopover(null)}
                      className="flex-1 px-2 py-1.5 text-xs rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-500 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { setOpenPopover(null); stopScreenShare(); }}
                      className="flex-1 px-2 py-1.5 text-xs rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                    >
                      Stop
                    </button>
                  </div>
                </div>
              </Floating>
              <Floating anchor={anchorFor('share')} open={openPopover === 'quality' && !isSharing} zClass="z-50">
                <div className="bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg py-1 min-w-[180px]">
                  {(Object.entries(QUALITY_PRESETS) as [ShareQuality, (typeof QUALITY_PRESETS)[ShareQuality]][]).map(
                    ([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => {
                          setOpenPopover(null);
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
                  {isSafari && !safariWarnDismissed && (
                    <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-600 mt-1 flex items-start gap-2">
                      <p className="text-[10px] text-amber-400 flex-1">
                        Safari has limited screen share quality (VP8 only, no audio). Chrome or Firefox recommended.
                      </p>
                      <button
                        onClick={() => { setSafariWarnDismissed(true); localStorage.setItem('safariCodecWarnDismissed', '1'); }}
                        className="text-zinc-400 hover:text-zinc-200 text-xs shrink-0"
                        aria-label="Dismiss Safari warning"
                      >×</button>
                    </div>
                  )}
                  {isSafari && safariWarnDismissed && (
                    <p className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-200 dark:border-zinc-600 mt-1">
                      Safari: VP8 only, no audio capture
                    </p>
                  )}
                </div>
              </Floating>

              {currentRoom && (
                <Floating anchor={anchorFor('music')} open={openPopover === 'music' && hasMusicBot} zClass="z-50">
                  <MusicControls status={musicStatus} onRefresh={refreshMusicStatus} pipe={pipe} roomId={currentRoom.id} />
                </Floating>
              )}
              {currentRoom && (
                <Floating anchor={anchorFor('pipe')} open={openPopover === 'pipe' && showPipe} zClass="z-50">
                  <div
                    className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl p-4 w-[340px] max-w-[calc(100vw-1rem)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-2">Pipe audio to {currentRoom.name}</h3>
                    <PipePanel pipe={pipe} roomId={currentRoom.id} />
                  </div>
                </Floating>
              )}

              <Floating anchor={anchorFor('soundboard')} open={openPopover === 'soundboard'} zClass="z-50">
                <Soundboard
                  clips={clips}
                  playingId={playingId}
                  previewingId={previewingId}
                  volume={sbVolume}
                  onVolumeChange={setSbVolume}
                  onPlay={playClip}
                  onStop={stopPlaying}
                  onPreview={previewClip}
                  onStopPreview={stopPreview}
                  onUpload={uploadClip}
                  onDelete={deleteClip}
                />
              </Floating>

            </>
          );
        })()}
      </main>

      {/* Side panel — People / Chat */}
      <SidePanel
        open={panelOpen}
        onClose={() => setPanelVisible(false)}
        overlay={panelOverlay}
        tab={panelTab}
        onTabChange={setPanelTab}
        chatUnread={chatUnread}
        chat={
          <ChatPanel
            entries={chatHistory}
            currentUserId={user.id}
            roomName={currentRoom?.name ?? null}
            connected={connectionState === ConnectionState.Connected}
            visible={chatVisible}
          />
        }
        people={
          <PeopleList
            users={users}
            currentUserId={user.id}
            currentRoomId={currentRoom?.id ?? null}
            roomMembers={roomMembers}
            rooms={rooms}
            speaking={speakingUsernames}
            micOff={micOffUsernames}
            mutedForMe={mutedUsers}
            onToggleMute={toggleMuteUser}
            getVolume={getVolume}
            onVolumeChange={setVolume}
          />
        }
      />
    </div>
  );
}
