/**
 * Products per /model/[slug] listing page. Its own module (not vehicleMetadata.ts)
 * so the client listing can import it without pulling server fetch code into the
 * browser bundle; the server-side range check reads the same value.
 */
export const VEHICLE_PAGE_SIZE = 12;
