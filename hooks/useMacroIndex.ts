import useSWR from 'swr';
import { useEffect, useRef } from 'react';
import { useSoundAlerts } from './useSoundAlerts';

export interface RisingRisk {
    title: string;
    points: string;
    driver: string;
}

export interface MacroIndexData {
    index: number;
    risingRisks: RisingRisk[];
    hasJumped: boolean;
}

const fetcher = async () => {
    let p = (window as any).puter;
    if (!p || !p.kv) return { index: 50, risingRisks: [], hasJumped: false };

    try {
        const [indexRaw, risksRaw] = await Promise.all([
            p.kv.get('macro:index'),
            p.kv.get('macro:rising_risks')
        ]);

        const index = indexRaw ? JSON.parse(indexRaw).value : 50;
        const risingRisks = risksRaw ? JSON.parse(risksRaw).value : [];

        return { index, risingRisks, hasJumped: false };
    } catch (err) {
        console.error('Error fetching macro index:', err);
        return { index: 50, risingRisks: [], hasJumped: false };
    }
};

export function useMacroIndex() {
    const { data, ...rest } = useSWR<MacroIndexData>('macroIndex', fetcher, {
        refreshInterval: 15000,
        revalidateOnFocus: true
    });

    const prevIndexRef = useRef<number | null>(null);
    const { triggerAlert } = useSoundAlerts();

    // Determine if it jumped
    const indexWithJump = data ? { ...data } : data;

    useEffect(() => {
        if (data && prevIndexRef.current !== null) {
            if (data.index - prevIndexRef.current > 8) {
                indexWithJump!.hasJumped = true;
                triggerAlert('Critical Market Instability Jump Detected!');
            }
        }
        if (data && prevIndexRef.current !== data.index) {
            prevIndexRef.current = data.index;
        }
    }, [data, triggerAlert]);

    return { data: indexWithJump, ...rest };
}
