import { Mic, MicOff, Camera, CameraOff, Ear, EarOff, Monitor, MonitorOff, Music, AudioLines, Settings, MessageSquare } from 'lucide-react';
import { ControlButton } from './ControlButton';

export type ControlKey = 'share' | 'music' | 'pipe' | 'soundboard' | 'settings';

interface ControlBarProps {
  micMuted: boolean;
  onToggleMute: () => void;
  cameraOn: boolean;
  onToggleCamera: () => void;
  deafened: boolean;
  onToggleDeafen: () => void;
  /** Screen share (not offered on phones) */
  showShare: boolean;
  sharing: boolean;
  shareTooltip: string;
  onShare: () => void;
  showMusic: boolean;
  onMusic: () => void;
  showPipe: boolean;
  onPipe: () => void;
  onSoundboard: () => void;
  onSettings: () => void;
  chatOpen: boolean;
  chatUnread: number;
  onChat: () => void;
  /** Registers a button so its popover (rendered by the room) can anchor to it */
  buttonRef: (key: ControlKey) => (el: HTMLButtonElement | null) => void;
}

/**
 * Bottom control bar. The room docks it to the stage (centred on it, not the window),
 * under the vote card when one is running. Every button always shows — at every width the
 * side panels allow the row fits; wrapping is only a last-resort fallback.
 */
export function ControlBar(props: ControlBarProps) {
  const { micMuted, cameraOn, deafened, sharing, buttonRef } = props;
  return (
    <div className="pointer-events-auto max-w-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl rounded-2xl px-3 py-2 shadow-lg border border-zinc-200/50 dark:border-zinc-700/50">
      <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
        <ControlButton
          tone={micMuted ? 'danger' : 'neutral'}
          label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          tooltip={micMuted ? 'Unmute' : 'Mute'}
          onClick={props.onToggleMute}
        >
          {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </ControlButton>
        <ControlButton
          tone={cameraOn ? 'success' : 'neutral'}
          label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          tooltip={cameraOn ? 'Camera Off' : 'Camera On'}
          onClick={props.onToggleCamera}
        >
          {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
        </ControlButton>
        <ControlButton tone={deafened ? 'danger' : 'neutral'} label={deafened ? 'Undeafen' : 'Deafen'} onClick={props.onToggleDeafen}>
          {deafened ? <EarOff size={18} /> : <Ear size={18} />}
        </ControlButton>
        {props.showShare && (
          <ControlButton
            ref={buttonRef('share')}
            tone={sharing ? 'success' : 'neutral'}
            label={sharing ? 'Stop screen share' : 'Share screen'}
            tooltip={props.shareTooltip}
            onClick={props.onShare}
          >
            {sharing ? <Monitor size={18} /> : <MonitorOff size={18} />}
          </ControlButton>
        )}
        {props.showMusic && (
          <ControlButton ref={buttonRef('music')} label="Open music controls" tooltip="Music" onClick={props.onMusic}>
            <Music size={18} />
          </ControlButton>
        )}
        {props.showPipe && (
          <ControlButton ref={buttonRef('pipe')} label="Pipe audio to this room" tooltip="Pipe audio" onClick={props.onPipe}>
            <Music size={18} />
          </ControlButton>
        )}
        <ControlButton ref={buttonRef('soundboard')} label="Open soundboard" tooltip="Soundboard" onClick={props.onSoundboard}>
          <AudioLines size={18} />
        </ControlButton>
        <ControlButton ref={buttonRef('settings')} label="Open settings" tooltip="Settings" onClick={props.onSettings}>
          <Settings size={18} />
        </ControlButton>
        <ControlButton
          tone={props.chatOpen ? 'accent' : 'neutral'}
          label={props.chatOpen ? 'Hide chat' : 'Show chat'}
          tooltip={props.chatUnread > 0 ? `Chat — ${props.chatUnread} new` : 'Chat'}
          aria-pressed={props.chatOpen}
          className="relative"
          onClick={props.onChat}
        >
          <MessageSquare size={18} />
          {props.chatUnread > 0 && !props.chatOpen && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-indigo-500 text-[10px] font-bold text-white flex items-center justify-center">
              {props.chatUnread > 99 ? '99+' : props.chatUnread}
            </span>
          )}
        </ControlButton>
      </div>
    </div>
  );
}
