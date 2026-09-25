/**
 * dsh-archive-manager — Typert Host manifest.
 *
 * Hand-written TYPERT manifest (the format the DSH typert-loader consumes from
 * the package's `./typert` export). It describes the `archiveManager` Remote
 * service the Host half publishes so the browser Client half can call it
 * through `ctx.remote.archiveManager.{restore,delete,state}`.
 *
 * Keep the invocation ids, service/namespace names and method names in sync
 * with `index.js` (ArchiveManagerService) and `client.js`.
 *
 * Cross-version note: strict codecs carry BOTH `schema` (DSH < 0.1.7 reads
 * the zod instance) and `create` (DSH >= 0.1.7 requires the factory) — see
 * the codec contract comment below before touching any codec.
 */

import { z } from "zod";

// ---- shared shapes ---------------------------------------------------------
//
// DSH-versioned codec contract (the ONE field that differs across DSH builds):
//   - DSH < 0.1.7 (typert-loader / typert-registry): a strict codec must carry
//     `codec.schema` — a zod v4 INSTANCE (`_zod` + `parse`) — and the runtime
//     calls `codec.schema.parse(...)`.
//   - DSH >= 0.1.7: a strict codec must carry `codec.create` — a FACTORY
//     function returning a zod schema — and the runtime calls
//     `codec.create().parse(...)`; a plain instance in `schema` fails
//     validation with "strict codec has no create() factory".
// Every codec below therefore carries BOTH: `schema` (materialized instance,
// read by <0.1.7) and `create` (memoized factory, read by >=0.1.7). Each
// version's validator only inspects its own field, so the extra field is
// ignored everywhere. Same for TYPERT.schemas entries (0.1.7 requires
// `create`; our list stays empty, which satisfies both).

/**
 * Memoize one zod schema behind a `create()`-style factory: repeated calls
 * return the same instance (the official 0.1.7 manifests use this exact
 * `value ??= build()` pattern).
 *
 * @param {() => object} build - constructs the zod schema once.
 * @returns {() => object} the factory.
 */
function lazy(build) {
  let value;
  return () => (value ??= build());
}

const sessionIdSchema = lazy(() => z.intersection(z.string(), z.unknown()).readonly());

const restoreResultSchema = lazy(() =>
  z.union([
    z.object({
      ok: z.literal(true).readonly(),
      value: z.object({
        restored: z.literal(true).readonly(),
      }).readonly(),
    }).readonly(),
    z.object({
      ok: z.literal(false).readonly(),
      error: z.object({
        code: z.string().readonly(),
        message: z.string().readonly().optional(),
      }).readonly(),
    }).readonly(),
  ])
);

const deleteResultSchema = lazy(() =>
  z.union([
    z.object({
      ok: z.literal(true).readonly(),
      value: z.object({
        fileRemoved: z.boolean().readonly(),
        live: z.boolean().readonly(),
      }).readonly(),
    }).readonly(),
    z.object({
      ok: z.literal(false).readonly(),
      error: z.object({
        code: z.string().readonly(),
        message: z.string().readonly().optional(),
      }).readonly(),
    }).readonly(),
  ])
);

const stateResultSchema = lazy(() =>
  z.union([
    z.object({
      ok: z.literal(true).readonly(),
      value: z.object({
        ghostIds: z.array(sessionIdSchema()).readonly(),
      }).readonly(),
    }).readonly(),
    z.object({
      ok: z.literal(false).readonly(),
      error: z.object({
        code: z.string().readonly(),
        message: z.string().readonly().optional(),
      }).readonly(),
    }).readonly(),
  ])
);

// ---- per-invocation parameter/result schemas -------------------------------

const restoreRequestSchema = lazy(() =>
  z.object({
    sessionId: sessionIdSchema(),
  })
);

const deleteRequestSchema = lazy(() =>
  z.object({
    sessionId: sessionIdSchema(),
  })
);

/**
 * Build the dual-version strict codec: `schema` for DSH < 0.1.7 (instance
 * read at validation time), `create` for DSH >= 0.1.7 (factory invoked by
 * the runtime). Both point at the same memoized instance.
 *
 * @param {string} typeSymbol - wire type symbol.
 * @param {() => object} factory - the memoized schema factory.
 * @returns {object} the codec descriptor.
 */
function strictCodec(typeSymbol, factory) {
  return {
    mode: "strict",
    typeSymbol,
    schema: factory(),
    create: factory,
  };
}

export const TYPERT = {
  package: "@duke-dsh-plugins/dsh-archive-manager",
  face: "host",
  schemas: [],
  invocations: [
    {
      id: "dsh-archive-manager#archiveManager/restore",
      service: "archiveManager",
      namespace: "archiveManager",
      method: "restore",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "request",
          wire: "request",
          source: "json",
          codec: strictCodec(
            "dsh-archive-manager#ArchiveManagerRestoreRequest",
            restoreRequestSchema
          ),
        },
      ],
      result: strictCodec(
        "dsh-archive-manager#ArchiveManagerRestoreResult",
        restoreResultSchema
      ),
      sourceLocation: { file: "index.js", line: 1, column: 1 },
    },
    {
      id: "dsh-archive-manager#archiveManager/delete",
      service: "archiveManager",
      namespace: "archiveManager",
      method: "delete",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "request",
          wire: "request",
          source: "json",
          codec: strictCodec(
            "dsh-archive-manager#ArchiveManagerDeleteRequest",
            deleteRequestSchema
          ),
        },
      ],
      result: strictCodec(
        "dsh-archive-manager#ArchiveManagerDeleteResult",
        deleteResultSchema
      ),
      sourceLocation: { file: "index.js", line: 1, column: 1 },
    },
    {
      id: "dsh-archive-manager#archiveManager/state",
      service: "archiveManager",
      namespace: "archiveManager",
      method: "state",
      invocation: { kind: "direct" },
      parameters: [],
      result: strictCodec(
        "dsh-archive-manager#ArchiveManagerStateResult",
        stateResultSchema
      ),
      sourceLocation: { file: "index.js", line: 1, column: 1 },
    },
  ],
  model: {
    services: [
      {
        description:
          "Archive manager service: restore, delete and inspect archived sessions for the DeepSeek Harness web UI.",
        summary: "Archive manager service.",
        tags: [],
        jsDoc:
          "/**\n * Archive manager service: restore, delete and inspect archived sessions.\n */",
        key: "archiveManager",
        exportName: "ArchiveManagerService",
        members: [
          {
            kind: "method",
            name: "restore",
            signature:
              "@Remote('restore') async restore(request: ArchiveManagerRestoreRequest): Promise<ArchiveManagerRestoreResult>",
            summary: "Remove one session from the archive set so it returns to its project slot.",
            jsDoc:
              "/**\n * Remove one session from the archive set so it returns to its project slot.\n * @param request - target session id.\n * @returns success or a business failure.\n */",
          },
          {
            kind: "method",
            name: "delete",
            signature:
              "@Remote('delete') async delete(request: ArchiveManagerDeleteRequest): Promise<ArchiveManagerDeleteResult>",
            summary: "Permanently delete one archived session's log directory and clear its archive entry.",
            jsDoc:
              "/**\n * Permanently delete one archived session's log directory and clear its archive\n * entry. Refuses sessions whose agent is running; live-but-idle sessions keep\n * their entry (ghost) until restart.\n * @param request - target session id.\n * @returns success or a business failure.\n */",
          },
          {
            kind: "method",
            name: "state",
            signature:
              "@Remote('state') async state(): Promise<ArchiveManagerStateResult>",
            summary: "Report archived sessions that are live in memory but whose logs are gone.",
            jsDoc:
              "/**\n * Report archived sessions that are still live in memory while their log files\n * no longer exist (ghost records the client hides).\n * @returns the ghost session ids.\n */",
          },
        ],
        types: [
          {
            name: "ArchiveManagerRestoreRequest",
            declaration:
              "export interface ArchiveManagerRestoreRequest {\n    readonly sessionId: SessionId;\n}",
          },
          {
            name: "ArchiveManagerRestoreResult",
            declaration:
              "export type ArchiveManagerRestoreResult = { ok: true; value: { restored: true } } | { ok: false; error: { code: string; message?: string } };",
          },
          {
            name: "ArchiveManagerDeleteRequest",
            declaration:
              "export interface ArchiveManagerDeleteRequest {\n    readonly sessionId: SessionId;\n}",
          },
          {
            name: "ArchiveManagerDeleteResult",
            declaration:
              "export type ArchiveManagerDeleteResult = { ok: true; value: { fileRemoved: boolean; live: boolean } } | { ok: false; error: { code: string; message?: string } };",
          },
          {
            name: "ArchiveManagerStateResult",
            declaration:
              "export type ArchiveManagerStateResult = { ok: true; value: { ghostIds: readonly SessionId[] } } | { ok: false; error: { code: string; message?: string } };",
          },
          {
            name: "SessionId",
            declaration: "export type SessionId = Branded<'SessionId'>;",
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
};
