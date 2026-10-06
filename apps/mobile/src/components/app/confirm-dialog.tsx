import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { AlertTriangle, AlertCircle, Info, LogOut } from 'lucide-react-native';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string | null;
  type?: 'danger' | 'warning' | 'info';
  icon?: 'alert' | 'logout' | 'info';
  onConfirm: () => void;
  onCancel?: () => void;
  confirmTestID?: string;
  cancelTestID?: string;
  useNativeModal?: boolean;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  type = 'warning',
  icon = 'alert',
  useNativeModal = true,
  onConfirm,
  onCancel,
  confirmTestID,
  cancelTestID,
}: ConfirmDialogProps) {
  if (!visible) return null;

  const actualConfirmTestID = confirmTestID || confirmText;
  const actualCancelTestID = cancelTestID || cancelText || undefined;
  const handleCancel = onCancel || onConfirm;

  const renderIcon = () => {
    if (icon === 'logout') {
      return (
        <View style={[styles.iconWrapper, styles.iconWrapperDanger]}>
          <LogOut size={24} color="#EF4444" />
        </View>
      );
    }
    if (type === 'danger') {
      return (
        <View style={[styles.iconWrapper, styles.iconWrapperDanger]}>
          <AlertTriangle size={24} color="#EF4444" />
        </View>
      );
    }
    if (type === 'info') {
      return (
        <View style={[styles.iconWrapper, styles.iconWrapperInfo]}>
          <Info size={24} color="#38BDF8" />
        </View>
      );
    }
    return (
      <View style={[styles.iconWrapper, styles.iconWrapperWarning]}>
        <AlertCircle size={24} color="#F59E0B" />
      </View>
    );
  };

  const dialogBody = (
    <View style={styles.overlay}>
      {/* 点击遮罩关闭区域 */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={handleCancel}
        accessible={false}
      />

      <View style={styles.dialogContainer}>
        {/* 顶部图标徽章 */}
        {renderIcon()}

        {/* 标题 */}
        <Text style={styles.titleText}>{title}</Text>

        {/* 描述信息 */}
        {!!message && <Text style={styles.messageText}>{message}</Text>}

        {/* 操作按钮组 */}
        <View style={styles.actionRow}>
          {!!cancelText && (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={handleCancel}
              activeOpacity={0.75}
              testID={actualCancelTestID}
            >
              <Text style={styles.cancelBtnText}>{cancelText}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.confirmBtn,
              type === 'danger' ? styles.confirmBtnDanger : styles.confirmBtnNormal,
            ]}
            onPress={onConfirm}
            activeOpacity={0.8}
            testID={actualConfirmTestID}
          >
            <Text style={styles.confirmBtnText}>{confirmText}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (!useNativeModal) {
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 99999, elevation: 99999 }]}>
        {dialogBody}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      {dialogBody}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  dialogContainer: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#18181f',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
  },
  iconWrapperDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  iconWrapperWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  iconWrapperInfo: {
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  messageText: {
    color: '#9CA3AF',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
    paddingHorizontal: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelBtnText: {
    color: '#C4C4D0',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  confirmBtnDanger: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  confirmBtnNormal: {
    backgroundColor: '#F97316',
    shadowColor: '#F97316',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
