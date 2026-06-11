import Zone, { IZone } from '../models/Zone';

/**
 * findZoneByCoordinates
 * Finds the first active zone that contains the given [lng, lat] coordinates.
 */
export const findZoneByCoordinates = async (lng: number, lat: number, countryCode: string): Promise<IZone | null> => {
    return await Zone.findOne({
        countryCode,
        isActive: true,
        boundary: {
            $geoIntersects: {
                $geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                }
            }
        }
    });
};

/**
 * resolveZoneForLocation
 * Reusable resolver for any location-based zone lookup.
 */
export const resolveZoneForLocation = async (coordinates: number[], countryCode: string): Promise<IZone | null> => {
    if (!coordinates || coordinates.length !== 2) return null;
    return await findZoneByCoordinates(coordinates[0], coordinates[1], countryCode);
};

/**
 * findZoneByPolygon
 * Finds zones that overlap with a given polygon.
 */
export const findZonesByPolygon = async (polygon: number[][][], countryCode: string): Promise<IZone[]> => {
    return await Zone.find({
        countryCode,
        isActive: true,
        boundary: {
            $geoIntersects: {
                $geometry: {
                    type: 'Polygon',
                    coordinates: polygon
                }
            }
        }
    });
};

/**
 * resolveZoneForJob
 */
export const resolveZoneForJob = async (job: any): Promise<IZone | null> => {
    return await resolveZoneForLocation(job.location.coordinates, job.countryCode);
};

/**
 * resolveZoneForProvider
 */
export const resolveZoneForProvider = async (provider: any): Promise<IZone | null> => {
    return await resolveZoneForLocation(provider.location.coordinates, provider.countryCode);
};
