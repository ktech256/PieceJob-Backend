export function calculateDistance(c1: number[], c2: number[]) {
    if (!c1 || !c2 || c1.length < 2 || c2.length < 2) return Infinity;

    const R = 6371e3; // meters
    const lat1 = c1[1] * Math.PI/180;
    const lat2 = c2[1] * Math.PI/180;
    const dLat = (c2[1]-c1[1]) * Math.PI/180;
    const dLon = (c2[0]-c1[0]) * Math.PI/180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in meters
}
