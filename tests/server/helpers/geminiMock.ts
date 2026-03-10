export const MOCK_GEMINI_SCHEDULE_RESPONSE = {
  name: 'HVAC',
  nextMaintenanceDates: {
    minor: '2030-01-01T00:00:00.000Z',
    major: '2030-06-01T00:00:00.000Z',
  },
  maintenanceSchedule: {
    minorIntervalMonths: '12',
    minorTasks: ['Inspect filter', 'Clean vents', 'Check airflow'],
    majorIntervalMonths: '60',
    majorTasks: ['Service compressor', 'Inspect coils', 'Full tune-up'],
  },
  reasoning: 'Mocked response for tests',
};

export const MOCK_GEMINI_TASK_SUGGESTION = {
  title: 'Mocked Gemini Response',
  description: 'Mocked maintenance suggestion for test coverage.',
  category: 'HVAC & Mechanical',
  priority: 'Medium',
  frequency: 'Quarterly',
  reasoning: 'Mocked response for provider/key routing tests.',
};
