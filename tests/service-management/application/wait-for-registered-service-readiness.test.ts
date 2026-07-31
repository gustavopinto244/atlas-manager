/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import {
  InvalidReadinessPolicyError,
  RegisteredServiceReadinessTimeoutError,
  WaitForRegisteredServiceReadiness,
} from "../../../src/service-management/application/wait-for-registered-service-readiness.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type {
  ServiceReadinessReader,
  ServiceReadinessState,
} from "../../../src/service-management/application/ports/service-readiness-reader.js";
import type { ServiceReadinessTimer } from "../../../src/service-management/application/ports/service-readiness-timer.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ReadinessPolicy } from "../../../src/service-management/domain/readiness-policy.js";
import { createControlledTime } from "../../test-helpers/controlled-time.js";

const SERVICE_ID = "test-service";

function createServiceWithPolicy(policy: ReadinessPolicy): RegisteredService {
  return RegisteredService.create({
    id: SERVICE_ID,
    displayName: "Test Service",
    managementAdapter: "mock",
    externalResourceId: "test-resource",
    supportedOperations: ["readStatus", "start", "stop"],
    availabilityPolicy: { mode: "manual" },
    readinessPolicy: {
      mode: policy.mode,
      timeoutMilliseconds: policy.timeoutMilliseconds,
      pollIntervalMilliseconds: policy.pollIntervalMilliseconds,
    },
  });
}

function createServiceWithInvalidPolicy(
  policy: ReadinessPolicy,
): RegisteredService {
  // Cria um serviço válido primeiro, depois sobrescreve a policy com valores inválidos
  // para testar a validação defensiva no WaitForRegisteredServiceReadiness
  const validService = RegisteredService.create({
    id: SERVICE_ID,
    displayName: "Test Service",
    managementAdapter: "mock",
    externalResourceId: "test-resource",
    supportedOperations: ["readStatus", "start", "stop"],
    availabilityPolicy: { mode: "manual" },
  });

  return Object.freeze({
    ...validService,
    readinessPolicy: policy,
  });
}

function createCatalog(service: RegisteredService): RegisteredServiceCatalog {
  return {
    list: vi.fn().mockResolvedValue([service]),
    findById: vi.fn().mockResolvedValue(service),
  };
}

describe("WaitForRegisteredServiceReadiness", () => {
  describe("successful readiness", () => {
    it("returns immediately when service is ready on first check", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 5000,
        pollIntervalMilliseconds: 500,
      };
      const service = createServiceWithPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      let checkCalls = 0;
      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => {
            checkCalls++;
            return {
              serviceId: SERVICE_ID,
              observedAt: controlledTime.now().toISOString(),
              state: "ready",
            };
          },
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await waitForReadiness.execute(SERVICE_ID);

      expect(checkCalls).toBe(1);
      expect(reader.check).toHaveBeenCalledOnce();
      expect(controlledTime.now().getTime()).toBe(
        new Date("2026-07-27T12:00:00.000Z").getTime(),
      );
    });

    it("polls until service becomes ready after several checks", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 5000,
        pollIntervalMilliseconds: 500,
      };
      const service = createServiceWithPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      let checkCalls = 0;
      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => {
            checkCalls++;
            return {
              serviceId: SERVICE_ID,
              observedAt: controlledTime.now().toISOString(),
              state: checkCalls >= 3 ? "ready" : "not_ready",
            };
          },
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await waitForReadiness.execute(SERVICE_ID);

      expect(checkCalls).toBe(3);
      expect(reader.check).toHaveBeenCalledTimes(3);
      // 2 sleeps de 500ms cada = 1000ms
      expect(controlledTime.now().getTime()).toBe(
        new Date("2026-07-27T12:00:01.000Z").getTime(),
      );
    });

    it("completes valid flow without premature maxAttempts interruption", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 3000,
        pollIntervalMilliseconds: 1000,
      };
      const service = createServiceWithPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      // maxAttempts = ceil(3000/1000) + 1 = 4
      // Vamos fazer o serviço ficar ready na tentativa 3 (antes do limite)
      let checkCalls = 0;
      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => {
            checkCalls++;
            return {
              serviceId: SERVICE_ID,
              observedAt: controlledTime.now().toISOString(),
              state: checkCalls >= 3 ? "ready" : "not_ready",
            };
          },
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await waitForReadiness.execute(SERVICE_ID);

      expect(checkCalls).toBe(3);
      expect(reader.check).toHaveBeenCalledTimes(3);
    });
  });

  describe("timeout scenarios", () => {
    it("throws timeout error when service never becomes ready and deadline is exceeded", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 2000,
        pollIntervalMilliseconds: 500,
      };
      const service = createServiceWithPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: controlledTime.now().toISOString(),
            state: "not_ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        RegisteredServiceReadinessTimeoutError,
      );

      // maxAttempts = ceil(2000/500) + 1 = 5
      // Após 4 sleeps de 500ms = 2000ms, o clock atinge o deadline
      expect(reader.check).toHaveBeenCalledTimes(5);
      expect(controlledTime.now().getTime()).toBe(
        new Date("2026-07-27T12:00:02.000Z").getTime(),
      );
    });

    it("throws timeout error when clock is frozen and maxAttempts is exceeded", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 3000,
        pollIntervalMilliseconds: 500,
      };
      const service = createServiceWithPolicy(policy);
      const catalog = createCatalog(service);

      // Clock congelado - sempre retorna o mesmo instante
      const frozenClock = { now: () => new Date("2026-07-27T12:00:00.000Z") };
      const timer: ServiceReadinessTimer = {
        sleep: vi.fn().mockResolvedValue(undefined),
      };

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: "2026-07-27T12:00:00.000Z",
            state: "not_ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        timer,
        frozenClock,
      );

      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        RegisteredServiceReadinessTimeoutError,
      );

      // maxAttempts = ceil(3000/500) + 1 = 7
      // O loop deve parar após 7 tentativas
      // Como o clock está congelado, o deadline nunca é atingido,
      // mas o limite de tentativas é alcançado
      expect(reader.check).toHaveBeenCalledTimes(7);
      // sleep é chamado após cada check que não retorna ready,
      // exceto na última tentativa onde o loop termina
      expect(timer.sleep).toHaveBeenCalledTimes(7);
    });
  });

  describe("invalid policy scenarios", () => {
    it("throws InvalidReadinessPolicyError when pollInterval is zero", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 5000,
        pollIntervalMilliseconds: 0,
      };
      const service = createServiceWithInvalidPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: controlledTime.now().toISOString(),
            state: "ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        InvalidReadinessPolicyError,
      );
    });

    it("throws InvalidReadinessPolicyError when pollInterval is negative", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 5000,
        pollIntervalMilliseconds: -100,
      };
      const service = createServiceWithInvalidPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: controlledTime.now().toISOString(),
            state: "ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        InvalidReadinessPolicyError,
      );
    });

    it("throws timeout when pollInterval exceeds timeout", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 1000,
        pollIntervalMilliseconds: 5000,
      };
      const service = createServiceWithInvalidPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: controlledTime.now().toISOString(),
            state: "not_ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      // Este caso não deve lançar InvalidReadinessPolicyError porque
      // a fórmula ceil(1000/5000) + 1 = 1 + 1 = 2 é válida.
      // O loop vai executar 2 tentativas e o timeout será alcançado.
      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        RegisteredServiceReadinessTimeoutError,
      );
    });

    it("throws InvalidReadinessPolicyError when timeout is zero", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: 0,
        pollIntervalMilliseconds: 500,
      };
      const service = createServiceWithInvalidPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: controlledTime.now().toISOString(),
            state: "ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        InvalidReadinessPolicyError,
      );
    });

    it("throws InvalidReadinessPolicyError when timeout is negative", async () => {
      const policy: ReadinessPolicy = {
        mode: "runtime",
        timeoutMilliseconds: -1000,
        pollIntervalMilliseconds: 500,
      };
      const service = createServiceWithInvalidPolicy(policy);
      const catalog = createCatalog(service);

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: controlledTime.now().toISOString(),
            state: "ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        InvalidReadinessPolicyError,
      );
    });
  });

  describe("service not found", () => {
    it("throws RegisteredServiceNotFoundError when service does not exist", async () => {
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(null),
      };

      const controlledTime = createControlledTime(
        new Date("2026-07-27T12:00:00.000Z"),
      );

      const reader: ServiceReadinessReader = {
        check: vi.fn(
          async (): Promise<{
            serviceId: string;
            observedAt: string;
            state: ServiceReadinessState;
          }> => ({
            serviceId: SERVICE_ID,
            observedAt: controlledTime.now().toISOString(),
            state: "ready",
          }),
        ),
      };

      const waitForReadiness = new WaitForRegisteredServiceReadiness(
        catalog,
        reader,
        controlledTime.timer,
        controlledTime.clock,
      );

      await expect(waitForReadiness.execute(SERVICE_ID)).rejects.toThrow(
        "Registered service not found",
      );
    });
  });
});
