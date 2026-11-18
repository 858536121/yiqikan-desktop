import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ROOM_SESSION_STORAGE_KEY } from '../services/socket';

const GUIDE_KEY = '@yiqikan_home_room_guide';
type GuideStep = 'entry' | 'invite' | 'done';

export function useHomeRoomGuide() {
  const [step, setStep] = useState<GuideStep>();
  const current = useRef<GuideStep | undefined>(undefined);
  const usedEntry = useRef(false);

  function saveStep(next: GuideStep) {
    current.current = next;
    setStep(next);
    void AsyncStorage.setItem(GUIDE_KEY, next).catch(() => {});
  }

  useEffect(() => {
    let active = true;
    // Read the legacy identity before the room screen starts its socket session.
    void Promise.all([AsyncStorage.getItem(GUIDE_KEY), AsyncStorage.getItem(ROOM_SESSION_STORAGE_KEY)])
      .then(([saved, session]) => {
        if (!active) return;
        const initial: GuideStep = saved === 'entry' || saved === 'invite' || saved === 'done'
          ? saved : session ? 'done' : 'entry';
        const next = initial === 'entry' && usedEntry.current ? 'invite' : initial;
        if (next !== saved) saveStep(next);
        else { current.current = next; setStep(next); }
      }).catch(() => {});
    return () => { active = false; };
  }, []);

  function finishEntry() {
    usedEntry.current = true;
    if (current.current === 'entry') saveStep('invite');
  }

  function finishInvite() {
    if (current.current === 'invite' || current.current === 'entry') saveStep('done');
  }

  return { step, finishEntry, finishInvite };
}
