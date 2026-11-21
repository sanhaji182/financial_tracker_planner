import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CreateAccountModal } from '../components/modals/CreateAccountModal';
import { formatLocalDate, getLocalMonthBounds } from '../utils/date';

const mutateAsyncMock = vi.fn();

vi.mock('../hooks/useAccounts', () => ({
  useCreateAccount: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
  useUpdateAccount: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../stores/useToastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('UI, Modal Portal, Zero-Balance & Local Date Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = '';
  });

  it('portals Modal into document.body and manages nested stack + Escape + body overflow lock', async () => {
    const user = userEvent.setup();
    const onCloseParent = vi.fn();
    const onCloseChild = vi.fn();

    const { rerender } = render(
      <div data-testid="transformed-page" style={{ transform: 'translateY(0)' }}>
        <Modal isOpen={true} onClose={onCloseParent} title="Parent Modal">
          <p>Parent Content</p>
          <ConfirmDialog
            isOpen={true}
            onClose={onCloseChild}
            onConfirm={vi.fn()}
            title="Nested Confirm"
            description="Confirm action?"
          />
        </Modal>
      </div>
    );

    const pageRoot = screen.getByTestId('transformed-page');
    const parentDialog = screen.getByRole('dialog', { name: 'Parent Modal' });
    const childDialog = screen.getByRole('dialog', { name: 'Nested Confirm' });

    expect(pageRoot.contains(parentDialog)).toBe(false);
    expect(pageRoot.contains(childDialog)).toBe(false);
    expect(parentDialog.parentElement).toBe(document.body);
    expect(childDialog.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe('hidden');
    expect(Number(childDialog.style.zIndex)).toBeGreaterThan(Number(parentDialog.style.zIndex));

    await user.keyboard('{Escape}');
    expect(onCloseChild).toHaveBeenCalledTimes(1);
    expect(onCloseParent).not.toHaveBeenCalled();

    rerender(
      <div data-testid="transformed-page" style={{ transform: 'translateY(0)' }}>
        <Modal isOpen={true} onClose={onCloseParent} title="Parent Modal">
          <p>Parent Content</p>
          <ConfirmDialog
            isOpen={false}
            onClose={onCloseChild}
            onConfirm={vi.fn()}
            title="Nested Confirm"
            description="Confirm action?"
          />
        </Modal>
      </div>
    );

    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(onCloseParent).toHaveBeenCalledTimes(1);

    rerender(
      <div data-testid="transformed-page" style={{ transform: 'translateY(0)' }}>
        <Modal isOpen={false} onClose={onCloseParent} title="Parent Modal">
          <p>Parent Content</p>
        </Modal>
      </div>
    );

    expect(document.body.style.overflow).toBe('');
  });

  it('allows creating an account with initial_balance = 0', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mutateAsyncMock.mockResolvedValue({ id: 'acc-1' });

    render(<CreateAccountModal isOpen={true} onClose={onClose} />);

    const nameInput = screen.getByLabelText('Nama Rekening / Akun');
    const balanceInput = screen.getByLabelText('Saldo Awal') as HTMLInputElement;

    expect(balanceInput.value).toBe('0');

    await user.type(nameInput, 'Dompet Nol');
    await user.click(screen.getByRole('button', { name: 'Simpan Akun' }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Dompet Nol',
          initial_balance: 0,
        })
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('computes local YYYY-MM-DD month bounds without UTC timezone drift', () => {
    expect(formatLocalDate(new Date(2026, 10, 1))).toBe('2026-11-01');
    expect(getLocalMonthBounds(2026, 10)).toEqual({
      firstDay: '2026-11-01',
      lastDay: '2026-11-30',
    });
    expect(getLocalMonthBounds(2024, 1)).toEqual({
      firstDay: '2024-02-01',
      lastDay: '2024-02-29',
    });
  });
});
