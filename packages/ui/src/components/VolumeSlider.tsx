import { useState, useEffect } from 'react';

interface VolumeSliderProps {
  identity: string;
  displayName: string;
  volume: number;
  onChange: (volume: number) => void;
  compact?: boolean;
}

export function VolumeSlider({ displayName, volume, onChange, compact }: VolumeSliderProps) {
  const [localVolume, setLocalVolume] = useState(volume);

  // Sync from parent prop when it changes externally
  useEffect(() => {
    setLocalVolume(volume);
  }, [volume]);

  const percentage = Math.round(localVolume * 100);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value) / 100;
    setLocalVolume(newVolume);
    onChange(newVolume);
  };

  return (
    <div className={`flex items-center gap-2 ${compact ? 'py-0.5' : 'px-2 py-1'}`}>
      {!compact && (
        <span className="text-xs text-zinc-600 dark:text-zinc-400 w-16 truncate">
          {displayName}
        </span>
      )}
      <input
        type="range"
        min="0"
        max="100"
        value={percentage}
        onChange={handleChange}
        className="flex-1 h-1 accent-indigo-500 cursor-pointer"
      />
      <span className="text-xs text-zinc-500 w-8 text-right">{percentage}%</span>
    </div>
  );
}
