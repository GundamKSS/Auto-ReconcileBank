export type DirectoryEmployee = { employeeCode: string; employeeName: string; jobTitle: string };

// Treat SQL LIKE metacharacters as literal search text.
export function employeeSearchPattern(query: string): string {
  return `%${query.replace(/[~%_\[]/g, '~$&')}%`;
}
