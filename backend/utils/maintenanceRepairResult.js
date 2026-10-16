function maintenanceRepairResult(report) {
  const normalize = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;
    const trimmed = value.trim();
    const legacyResults = {
      resolved: "Resolved",
      fixed: "Resolved",
      "partially resolved": "Partially Resolved",
      "in progress": "Partially Resolved",
      "not resolved": "Not Resolved",
      unresolved: "Not Resolved",
      "not fixed": "Not Resolved",
      "pending further action": "Pending Further Action",
    };
    return legacyResults[trimmed.toLowerCase()] || trimmed;
  };

  return normalize(report?.repairResult) || normalize(report?.status);
}

module.exports = { maintenanceRepairResult };
