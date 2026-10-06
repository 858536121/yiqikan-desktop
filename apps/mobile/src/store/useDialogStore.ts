import { create } from 'zustand';

export interface DialogOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string | null;
  type?: 'danger' | 'warning' | 'info';
  icon?: 'alert' | 'logout' | 'info';
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  confirmTestID?: string;
  cancelTestID?: string;
}

export interface AlertOptions {
  title: string;
  message?: string;
  confirmText?: string;
  type?: 'danger' | 'warning' | 'info';
  icon?: 'alert' | 'logout' | 'info';
  onConfirm?: () => void | Promise<void>;
  confirmTestID?: string;
}

interface DialogState {
  currentDialog: DialogOptions | null;
  showConfirm: (options: DialogOptions) => void;
  showAlert: (options: AlertOptions) => void;
  closeDialog: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  currentDialog: null,
  showConfirm: (options) => set({ currentDialog: options }),
  showAlert: (options) =>
    set({
      currentDialog: {
        ...options,
        cancelText: null,
      },
    }),
  closeDialog: () => set({ currentDialog: null }),
}));

export const showConfirm = (options: DialogOptions) => {
  useDialogStore.getState().showConfirm(options);
};

export const showAlert = (options: AlertOptions) => {
  useDialogStore.getState().showAlert(options);
};
