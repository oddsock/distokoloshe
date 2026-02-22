import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  ConnectionState,
  RemoteParticipant,
  LocalParticipant,
  Participant,
  ExternalE2EEKeyProvider,
} from 'livekit-client';
import { getBaseUrl } from '../lib/api';

export interface RoomConnection {
  wsUrl: string;
  token: string;
  e2eeKey: string;
}

interface LiveKitRoomState {
  room: Room | null;
  localParticipant: LocalParticipant | null;
  remoteParticipants: RemoteParticipant[];
  activeSpeakers: string[];
  connectionState: ConnectionState;
  e2eeEnabled: boolean;
  stateVersion: number;
}

/** Check if the browser supports Encoded Transforms (required for LiveKit E2EE) */
function supportsE2EE(): boolean {
  return (
    typeof RTCRtpSender !== 'undefined' &&
    'transform' in RTCRtpSender.prototype
  );
}

export function useLiveKitRoom() {
  const [state, setState] = useState<LiveKitRoomState>({
    room: null,
    localParticipant: null,
    remoteParticipants: [],
    activeSpeakers: [],
    connectionState: ConnectionState.Disconnected,
    e2eeEnabled: false,
    stateVersion: 0,
  });

  const roomRef = useRef<Room | null>(null);
  const keyProviderRef = useRef<ExternalE2EEKeyProvider | null>(null);

  const updateParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    setState((s) => ({
      ...s,
      localParticipant: room.localParticipant,
      remoteParticipants: Array.from(room.remoteParticipants.values()),
      stateVersion: s.stateVersion + 1,
    }));
  }, []);

  const connect = useCallback(
    async (connection: RoomConnection) => {
      // Disconnect existing room and wait for teardown
      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }

      // Set up E2EE only if the browser supports Encoded Transforms
      const canE2EE = supportsE2EE();
      let keyProvider: ExternalE2EEKeyProvider | null = null;
      let e2eeWorker: Worker | undefined;

      if (canE2EE) {
        keyProvider = new ExternalE2EEKeyProvider();
        keyProviderRef.current = keyProvider;
        try {
          e2eeWorker = new Worker(
            new URL('livekit-client/e2ee-worker', import.meta.url),
            { type: 'module' },
          );
        } catch {
          console.warn('E2EE worker failed to load, falling back to transport encryption only');
        }
      } else {
        console.warn('Browser does not support Encoded Transforms — E2EE disabled, using DTLS-SRTP transport encryption');
      }

      // NOTE: The `e2ee` field in RoomOptions is the current stable API (livekit-client ^2.17).
      // If a future SDK version renames this to `encryption`, update this block.
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
        publishDefaults: {
          dtx: true,
          red: true,
        },
        ...(e2eeWorker && keyProvider
          ? {
              e2ee: {
                keyProvider,
                worker: e2eeWorker,
              },
            }
          : {}),
      });

      roomRef.current = room;

      // State listeners
      room.on(RoomEvent.ConnectionStateChanged, (connectionState) => {
        setState((s) => ({ ...s, connectionState }));
      });

      room.on(RoomEvent.ParticipantConnected, updateParticipants);
      room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
      room.on(RoomEvent.TrackSubscribed, updateParticipants);
      room.on(RoomEvent.TrackUnsubscribed, updateParticipants);
      room.on(RoomEvent.LocalTrackPublished, updateParticipants);
      room.on(RoomEvent.LocalTrackUnpublished, updateParticipants);
      room.on(RoomEvent.TrackMuted, updateParticipants);
      room.on(RoomEvent.TrackUnmuted, updateParticipants);
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        setState((s) => ({
          ...s,
          activeSpeakers: speakers.map((p) => p.identity),
        }));
      });

      // Resolve WebSocket URL: use API base URL if set (desktop), else current origin (web)
      const base = getBaseUrl();
      let wsUrl: string;
      if (base) {
        // Desktop: derive WS URL from the configured server URL
        const url = new URL(base);
        const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProtocol}//${url.host}${connection.wsUrl}`;
      } else {
        // Web: relative to current origin (proxied by nginx)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProtocol}//${window.location.host}${connection.wsUrl}`;
      }

      // Connect to room
      await room.connect(wsUrl, connection.token);

      // Enable E2EE after connection is established
      let e2eeActive = false;
      if (e2eeWorker && keyProvider) {
        try {
          await keyProvider.setKey(connection.e2eeKey);
          room.setE2EEEnabled(true);
          e2eeActive = true;
        } catch (err) {
          console.warn('E2EE setup failed, continuing with transport encryption:', err);
        }
      }

      // Request mic permission then immediately mute (muted by default)
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch (err) {
        console.warn('Mic init skipped (permission denied or no device):', err);
      }

      setState((s) => ({
        room,
        localParticipant: room.localParticipant,
        remoteParticipants: Array.from(room.remoteParticipants.values()),
        activeSpeakers: [],
        connectionState: room.state,
        e2eeEnabled: e2eeActive,
        stateVersion: s.stateVersion + 1,
      }));
    },
    [updateParticipants],
  );

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
    setState({
      room: null,
      localParticipant: null,
      remoteParticipants: [],
      activeSpeakers: [],
      connectionState: ConnectionState.Disconnected,
      e2eeEnabled: false,
      stateVersion: 0,
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  return { ...state, connect, disconnect };
}
