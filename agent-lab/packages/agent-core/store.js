// In-memory store for local runs, fake-data tests, and development.
// The same interface is what a Supabase-backed store must implement in prod:
//   saveRun, appendLog, createApproval, setApprovalStatus, listApprovals
// Swap createMemoryStore() for createSupabaseStore() without touching agents.

function createMemoryStore() {
  const runs = [];
  const logs = [];
  const approvals = [];

  return {
    async saveRun(run) {
      runs.push(run);
      return run;
    },

    async appendLog(entry) {
      const record = { at: new Date().toISOString(), ...entry };
      logs.push(record);
      return record;
    },

    async createApproval(approval) {
      const record = {
        id: `apr_${approvals.length + 1}`,
        status: "pending",
        created_at: new Date().toISOString(),
        ...approval,
      };
      approvals.push(record);
      return record;
    },

    async setApprovalStatus(id, status) {
      const record = approvals.find((a) => a.id === id);
      if (record) {
        record.status = status;
        record.decided_at = new Date().toISOString();
      }
      return record || null;
    },

    async listApprovals(filter = {}) {
      return approvals.filter((a) =>
        Object.entries(filter).every(([k, v]) => a[k] === v)
      );
    },

    // Test/debug helper — not part of the prod interface.
    _dump() {
      return { runs, logs, approvals };
    },
  };
}

module.exports = { createMemoryStore };
