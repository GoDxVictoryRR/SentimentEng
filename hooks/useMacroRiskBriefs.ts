import useSWR from 'swr';

export interface MacroRiskBrief {
    severity: 'High' | 'Med' | 'Low';
    ticker_impact: string;
    brief: string;
    source: string;
}

const fetcher = async () => {
    let p = (window as any).puter;
    if (!p || !p.kv) return [];

    try {
        const raw = await p.kv.get('macro:briefs');
        if (!raw) return [];
        return JSON.parse(raw).value as MacroRiskBrief[];
    } catch (err) {
        console.error('Error fetching macro briefs:', err);
        return [];
    }
};

export function useMacroRiskBriefs() {
    return useSWR<MacroRiskBrief[]>('macroRiskBriefs', fetcher, {
        refreshInterval: 15000,
        revalidateOnFocus: true
    });
}
