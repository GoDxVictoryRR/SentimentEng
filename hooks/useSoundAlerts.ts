'use client';

import { useEffect, useCallback } from 'react';
import { useMacroRiskBriefs } from './useMacroRiskBriefs';

export function useSoundAlerts() {
    const { data: briefs } = useMacroRiskBriefs();

    const triggerAlert = useCallback((message: string) => {
        // Attempt to play sound (may be blocked if no user interaction yet)
        try {
            const audio = new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/descent/gotitem.mp3');
            audio.volume = 0.5;
            audio.play().catch(e => console.warn('Audio play blocked:', e));
        } catch (e) { }

        // Trigger Notification if permitted
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                new Notification('WorldMonitor Alert', {
                    body: message,
                    icon: '/favicon.ico' // adjust as needed
                });
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification('WorldMonitor Alert', {
                            body: message,
                        });
                    }
                });
            }
        }
    }, []);

    useEffect(() => {
        // Only trigger for high severity briefs we haven't seen in this session
        // In a real app we'd track seen brief IDs, here we simplify
        const highBriefs = briefs?.filter(b => b.severity === 'High') || [];
        if (highBriefs.length > 0) {
            // Simplified: just alert on the latest high severity brief if array changes length
            // or just use logic in the index jump
        }
    }, [briefs]);

    return { triggerAlert };
}
