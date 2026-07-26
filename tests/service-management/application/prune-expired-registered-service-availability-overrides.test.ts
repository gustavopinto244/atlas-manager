import { describe, expect, it, vi } from "vitest";

import { ListRegisteredServices } from "../../../src/service-management/application/list-registered-services.js";
import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "../../../src/service-management/application/ports/service-availability-override-store.js";
import { PruneExpiredRegisteredServiceAvailabilityOverrides } from "../../../src/service-management/application/prune-expired-registered-service-availability-overrides.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { ServiceAvailabilityEvaluationError } from "../../../src/service-scheduling/domain/service-availability-evaluation-error.js";
import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";

const pruningInstant = new Date("2026-07-26T13:00:00.000Z");
const overrideCreationInstant = new Date("2026-07-26T10:00:00.000Z");

function createService(id: string): RegisteredService {
  return RegisteredService.create({
    id,
    displayName: id,
    managementAdapter: "mock",
    externalResourceId: id,
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
  });
}

function createOverride(
  expiresAt: string,
  kind: "keep_available" | "suspend_schedule" = "keep_available",
): ServiceAvailabilityOverride {
  return createServiceAvailabilityOverride(
    { kind, expiresAt },
    overrideCreationInstant,
  );
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function createSubject(services: readonly RegisteredService[] = []) {
  const list = vi
    .fn<RegisteredServiceCatalog["list"]>()
    .mockResolvedValue(services);
  const find = vi.fn<ServiceAvailabilityOverrideStore["findByServiceId"]>();
  const save = vi.fn<ServiceAvailabilityOverrideStore["save"]>();
  const remove = vi.fn<ServiceAvailabilityOverrideStore["removeByServiceId"]>();
  const removeIfMatches =
    vi.fn<ServiceAvailabilityOverrideStore["removeByServiceIdIfMatches"]>();
  const now = vi.fn<Clock["now"]>(() => pruningInstant);
  const catalog: RegisteredServiceCatalog = {
    list,
    findById: vi.fn(),
  };
  const listRegisteredServices = new ListRegisteredServices(catalog);
  const store: ServiceAvailabilityOverrideStore = {
    findByServiceId: find,
    save,
    removeByServiceId: remove,
    removeByServiceIdIfMatches: removeIfMatches,
  };
  const clock: Clock = {
    now,
  };

  return {
    subject: new PruneExpiredRegisteredServiceAvailabilityOverrides(
      listRegisteredServices,
      store,
      clock,
    ),
    list,
    find,
    save,
    remove,
    removeIfMatches,
    now,
    dependencies: { listRegisteredServices, store, clock },
  };
}

describe("PruneExpiredRegisteredServiceAvailabilityOverrides", () => {
  it("returns a frozen empty result after listing and capturing one instant", async () => {
    const { subject, list, find, save, remove, removeIfMatches, now } =
      createSubject();

    const result = await subject.execute();

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(list).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalledOnce();
    expect(find).not.toHaveBeenCalled();
    expect(removeIfMatches).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves catalog order across all outcomes and freezes each result", async () => {
    const services = [
      createService("missing"),
      createService("active"),
      createService("removed"),
      createService("changed"),
      createService("failed"),
    ];
    const activeOverride = createOverride("2026-07-26T13:00:00.001Z");
    const removedOverride = createOverride("2026-07-26T13:00:00.000Z");
    const changedOverride = createOverride(
      "2026-07-26T12:59:59.999Z",
      "suspend_schedule",
    );
    const failure = new Error("read failed");
    const { subject, find, removeIfMatches, remove, save, dependencies } =
      createSubject(services);
    find
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeOverride)
      .mockResolvedValueOnce(removedOverride)
      .mockResolvedValueOnce(changedOverride)
      .mockRejectedValueOnce(failure);
    removeIfMatches
      .mockResolvedValueOnce(Object.freeze({ kind: "removed" }))
      .mockResolvedValueOnce(Object.freeze({ kind: "not_removed" }));

    const result = await subject.execute();

    expect(result).toEqual([
      { kind: "no_override", serviceId: "missing" },
      { kind: "active", serviceId: "active" },
      { kind: "removed", serviceId: "removed" },
      { kind: "not_removed", serviceId: "changed" },
      { kind: "failed", serviceId: "failed", error: failure },
    ]);
    expect(removeIfMatches.mock.calls).toEqual([
      ["removed", removedOverride],
      ["changed", changedOverride],
    ]);
    expect(removeIfMatches.mock.calls[0]?.[1]).toBe(removedOverride);
    expect(removeIfMatches.mock.calls[1]?.[1]).toBe(changedOverride);
    expect(find.mock.calls.map(([serviceId]) => serviceId)).toEqual([
      "missing",
      "active",
      "removed",
      "changed",
      "failed",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(false);
    expect(services.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(activeOverride)).toBe(true);
    expect(Object.isFrozen(removedOverride)).toBe(true);
    expect(Object.isFrozen(changedOverride)).toBe(true);
    expect(Object.isFrozen(dependencies.listRegisteredServices)).toBe(false);
    expect(Object.isFrozen(dependencies.store)).toBe(false);
    expect(Object.isFrozen(dependencies.clock)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("isolates a conditional-removal failure and continues later services", async () => {
    const firstOverride = createOverride("2026-07-26T12:00:00.000Z");
    const secondOverride = createOverride("2026-07-26T11:00:00.000Z");
    const failure = new Error("write failed");
    const { subject, find, removeIfMatches } = createSubject([
      createService("first"),
      createService("second"),
    ]);
    find
      .mockResolvedValueOnce(firstOverride)
      .mockResolvedValueOnce(secondOverride);
    removeIfMatches
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(Object.freeze({ kind: "removed" }));

    await expect(subject.execute()).resolves.toEqual([
      { kind: "failed", serviceId: "first", error: failure },
      { kind: "removed", serviceId: "second" },
    ]);
    expect(removeIfMatches.mock.calls).toEqual([
      ["first", firstOverride],
      ["second", secondOverride],
    ]);
  });

  it("processes each lookup and optional removal sequentially", async () => {
    const firstOverride = createOverride("2026-07-26T12:00:00.000Z");
    const { subject, find, removeIfMatches } = createSubject([
      createService("first"),
      createService("second"),
    ]);
    const firstLookup = createDeferred<ServiceAvailabilityOverride>();
    const firstRemoval = createDeferred<Readonly<{ kind: "removed" }>>();
    find
      .mockImplementationOnce(() => firstLookup.promise)
      .mockResolvedValueOnce(null);
    removeIfMatches.mockImplementationOnce(() => firstRemoval.promise);

    const execution = subject.execute();
    await vi.waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    expect(find).toHaveBeenLastCalledWith("first");

    firstLookup.resolve(firstOverride);

    await vi.waitFor(() => expect(removeIfMatches).toHaveBeenCalledOnce());
    expect(find).toHaveBeenCalledTimes(1);

    firstRemoval.resolve(Object.freeze({ kind: "removed" }));

    await expect(execution).resolves.toEqual([
      { kind: "removed", serviceId: "first" },
      { kind: "no_override", serviceId: "second" },
    ]);
    expect(find.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("does not retry or reread after a concurrent replacement", async () => {
    const override = createOverride("2026-07-26T12:00:00.000Z");
    const { subject, find, removeIfMatches, remove } = createSubject([
      createService("service-a"),
    ]);
    find.mockResolvedValue(override);
    removeIfMatches.mockResolvedValue(Object.freeze({ kind: "not_removed" }));

    await expect(subject.execute()).resolves.toEqual([
      { kind: "not_removed", serviceId: "service-a" },
    ]);
    expect(find).toHaveBeenCalledOnce();
    expect(removeIfMatches).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects catalog failure before the clock or store is accessed", async () => {
    const failure = new Error("catalog failed");
    const { subject, list, now, find, removeIfMatches } = createSubject();
    list.mockRejectedValue(failure);

    await expect(subject.execute()).rejects.toBe(failure);
    expect(now).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(removeIfMatches).not.toHaveBeenCalled();
  });

  it("rejects clock failure before the store is accessed", async () => {
    const failure = new Error("clock failed");
    const { subject, now, find, removeIfMatches } = createSubject([
      createService("service-a"),
    ]);
    now.mockImplementation(() => {
      throw failure;
    });

    await expect(subject.execute()).rejects.toBe(failure);
    expect(now).toHaveBeenCalledOnce();
    expect(find).not.toHaveBeenCalled();
    expect(removeIfMatches).not.toHaveBeenCalled();
  });

  it("rejects an invalid shared instant before store access", async () => {
    const { subject, now, find, removeIfMatches } = createSubject([
      createService("service-a"),
    ]);
    now.mockReturnValue(new Date(Number.NaN));

    await expect(subject.execute()).rejects.toBeInstanceOf(
      ServiceAvailabilityEvaluationError,
    );
    expect(now).toHaveBeenCalledOnce();
    expect(find).not.toHaveBeenCalled();
    expect(removeIfMatches).not.toHaveBeenCalled();
  });

  it("captures one clock instant and does not use the system clock", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const { subject, find, now } = createSubject([
      createService("service-a"),
      createService("service-b"),
    ]);
    find
      .mockResolvedValueOnce(createOverride("2026-07-26T13:00:00.001Z"))
      .mockResolvedValueOnce(null);

    try {
      await subject.execute();

      expect(now).toHaveBeenCalledOnce();
      expect(dateNowSpy).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("does not inspect an override outside the registered catalog", async () => {
    const { subject, find, removeIfMatches } = createSubject([
      createService("registered"),
    ]);
    find.mockResolvedValue(null);

    await subject.execute();

    expect(find).toHaveBeenCalledExactlyOnceWith("registered");
    expect(find).not.toHaveBeenCalledWith("unregistered");
    expect(removeIfMatches).not.toHaveBeenCalled();
  });
});
