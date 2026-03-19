/**
 * Central parameter store.
 * All tunable values live here. The dev GUI reads/writes this object directly.
 * Export JSON from the GUI to persist to params.json.
 */

export const params = {
	segmentation: {
		confidenceThreshold: 0.3,
		temporalSmoothing: 0.4,
	},
};

export type Params = typeof params;
