import { useState, useEffect, useCallback } from 'react';

interface DeviceState {
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}

export function useDevices() {
  const [devices, setDevices] = useState<DeviceState>({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  });

  const enumerate = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audioInputs: allDevices.filter((d) => d.kind === 'audioinput'),
        audioOutputs: allDevices.filter((d) => d.kind === 'audiooutput'),
        videoInputs: allDevices.filter((d) => d.kind === 'videoinput'),
      });
    } catch {
      // Devices not available
    }
  }, []);

  useEffect(() => {
    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerate);
    };
  }, [enumerate]);

  return { ...devices, refresh: enumerate };
}
