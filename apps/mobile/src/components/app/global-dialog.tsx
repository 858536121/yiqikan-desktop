import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ConfirmDialog } from './confirm-dialog';
import { useDialogStore } from '../../store/useDialogStore';

export function GlobalDialog() {
  const currentDialog = useDialogStore((state) => state.currentDialog);
  const closeDialog = useDialogStore((state) => state.closeDialog);
  const [presentedDialog, setPresentedDialog] = useState(currentDialog);
  const [visible, setVisible] = useState(Boolean(currentDialog));
  const acceptingActions = useRef(Boolean(currentDialog));
  const dismissing = useRef(false);
  const pendingAction = useRef<(() => void | Promise<void>) | undefined>(undefined);

  const finishDismiss = () => {
    if (!dismissing.current) return;
    dismissing.current = false;
    const action = pendingAction.current;
    pendingAction.current = undefined;
    const next = useDialogStore.getState().currentDialog;
    acceptingActions.current = Boolean(next);
    setPresentedDialog(next);
    setVisible(Boolean(next));
    if (action) {
      Promise.resolve().then(action).catch(error => {
        useDialogStore.getState().showAlert({
          title: '操作失败', message: error?.message || '操作未完成，请重试',
          type: 'danger', icon: 'alert',
        });
      });
    }
  };

  const dismiss = (action?: () => void | Promise<void>) => {
    if (dismissing.current || !acceptingActions.current) return;
    // Keep the action claimed after Android dismissal, until a new dialog opens.
    acceptingActions.current = false;
    dismissing.current = true;
    pendingAction.current = action;
    setVisible(false);
    closeDialog();
    // Android does not emit the iOS Modal onDismiss callback.
    if (Platform.OS !== 'ios') finishDismiss();
  };

  useEffect(() => {
    // New dialogs stay in the store until the old native presentation is gone.
    if (dismissing.current) return;
    if (currentDialog) {
      acceptingActions.current = true;
      setPresentedDialog(currentDialog);
      setVisible(true);
    } else if (visible) {
      dismiss();
    }
  }, [currentDialog]);

  return (
    <ConfirmDialog
      visible={visible}
      title={presentedDialog?.title || ''}
      message={presentedDialog?.message}
      confirmText={presentedDialog?.confirmText || '确定'}
      cancelText={presentedDialog?.cancelText}
      type={presentedDialog?.type || 'warning'}
      icon={presentedDialog?.icon || 'alert'}
      confirmTestID={presentedDialog?.confirmTestID}
      cancelTestID={presentedDialog?.cancelTestID}
      onConfirm={() => dismiss(presentedDialog?.onConfirm)}
      onCancel={() => dismiss(presentedDialog?.onCancel)}
      onDismiss={finishDismiss}
    />
  );
}
