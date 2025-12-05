import { render, screen } from '@testing-library/react';
import AddTaskModal from './add-task-modal';

describe('AddTaskModal', () => {
  it('renders modal title', () => {
    render(<AddTaskModal open={true} onOpenChange={() => {}} />);
    expect(screen.getByText(/Add New Item \/ Task/i)).toBeInTheDocument();
  });
});