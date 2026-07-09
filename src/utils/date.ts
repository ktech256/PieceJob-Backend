/**
 * Formats a date to an ISO-like string in the specified timezone.
 * Maintains the YYYY-MM-DDTHH:mm:ss.000Z format but with local time values
 * for easy extraction by mobile apps.
 */
export const formatToWorkspaceTime = (date: any, timezone: string = 'UTC'): string | null => {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;

    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: timezone
        });

        const parts = formatter.formatToParts(d);
        const map = new Map(parts.map(p => [p.type, p.value]));

        // Return format: 2026-07-09T16:51:00.000Z (where 16:51 is local time)
        return `${map.get('year')}-${map.get('month')}-${map.get('day')}T${map.get('hour')}:${map.get('minute')}:${map.get('second')}.000Z`;
    } catch (e) {
        return d.toISOString();
    }
};
