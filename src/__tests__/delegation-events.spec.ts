// npx vitest run __tests__/delegation-events.spec.ts

import { SuperRooEventName, rooCodeEventsSchema, taskEventSchema } from "@superroo/types"

describe("delegation event schemas", () => {
	test("rooCodeEventsSchema validates tuples", () => {
		expect(() => (rooCodeEventsSchema.shape as any)[SuperRooEventName.TaskDelegated].parse(["p", "c"])).not.toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[SuperRooEventName.TaskDelegationCompleted].parse(["p", "c", "s"]),
		).not.toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[SuperRooEventName.TaskDelegationResumed].parse(["p", "c"]),
		).not.toThrow()

		// invalid shapes
		expect(() => (rooCodeEventsSchema.shape as any)[SuperRooEventName.TaskDelegated].parse(["p"])).toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[SuperRooEventName.TaskDelegationCompleted].parse(["p", "c"]),
		).toThrow()
		expect(() => (rooCodeEventsSchema.shape as any)[SuperRooEventName.TaskDelegationResumed].parse(["p"])).toThrow()
	})

	test("taskEventSchema discriminated union includes delegation events", () => {
		expect(() =>
			taskEventSchema.parse({
				eventName: SuperRooEventName.TaskDelegated,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: SuperRooEventName.TaskDelegationCompleted,
				payload: ["p", "c", "s"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: SuperRooEventName.TaskDelegationResumed,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()
	})
})
