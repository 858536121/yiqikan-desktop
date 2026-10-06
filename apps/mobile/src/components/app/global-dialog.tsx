import React from 'react';
import { ConfirmDialog } from './confirm-dialog';
import { useDialogStore } from '../../store/useDialogStore';

export function GlobalDialog() {
  const currentDialog = useDialogStore((state) => state.currentDialog);
  const closeDialog = useDialogStore((state) => state.closeDialog);

  if (!currentDialog) return null;

  return (
    <ConfirmDialog
      visible={Boolean(currentDialog)}
      title={currentDialog.title}
      message={currentDialog.message}
      confirmText={currentDialog.confirmText || '确定'}
      cancelText={currentDialog.cancelText}
      type={currentDialog.type || 'warning'}
      icon={currentDialog.icon || 'alert'}
      confirmTestID={currentDialog.confirmTestID}
      cancelTestID={currentDialog.cancelTestID}
      onConfirm={async () => {
        const fn = currentDialog.onConfirm;
        closeDialog();
        if (fn) await fn();
      }}
      onCancel={() => {
        const fn = currentDialog.onCancel;
        closeDialog();
        if (fn) fn();
      }}
    />
  );
}
