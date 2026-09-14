import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Linking, StatusBar, Platform, ActivityIndicator } from 'react-native';
import { AlertTriangle, Download, RefreshCw, CheckCircle2, ExternalLink } from 'lucide-react-native';
import { otaService } from '../../services/ota-service';

interface ForceUpdateOverlayProps {
  visible: boolean;
  releaseNotes: string;
  downloadUrl: string;
}

/**
 * 全屏强制更新遮罩层 —— 不可关闭、不可跳过。
 * 支持应用内一键高速下载 APK、实时进度条展示、自动唤起系统安装器，并提供浏览器兜底下载。
 */
export function ForceUpdateOverlay({ visible, releaseNotes, downloadUrl }: ForceUpdateOverlayProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadSizeText, setDownloadSizeText] = useState('');
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!visible) return null;

  const handleStartUpdate = async () => {
    // 如果已经下载完毕，点击重新调起安装
    if (isDownloaded && Platform.OS === 'android') {
      try {
        await otaService.installExistingApk();
      } catch (e: any) {
        setErrorMsg(e?.message || '调起安装器失败，请尝试在浏览器中下载');
      }
      return;
    }

    if (isDownloading) return;

    if (Platform.OS === 'android') {
      try {
        setIsDownloading(true);
        setErrorMsg('');
        setProgress(0);
        setDownloadSizeText('');

        await otaService.downloadAndInstallApk(downloadUrl, (percent, received, total) => {
          setProgress(percent);
          if (received && total && total > 0) {
            const recMb = (received / 1024 / 1024).toFixed(1);
            const totalMb = (total / 1024 / 1024).toFixed(1);
            setDownloadSizeText(`${recMb}MB / ${totalMb}MB`);
          }
        });

        setIsDownloaded(true);
      } catch (e: any) {
        console.warn('应用内下载安装失败:', e);
        setErrorMsg(e?.message || '下载失败，请点击下方在浏览器中打开');
      } finally {
        setIsDownloading(false);
      }
    } else {
      // iOS 或其他平台降级跳浏览器
      Linking.openURL(downloadUrl).catch(() => {});
    }
  };

  const handleOpenInBrowser = () => {
    if (downloadUrl) {
      Linking.openURL(downloadUrl).catch(() => {});
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      // 拦截 Android 物理返回键
      onRequestClose={() => {}}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <View style={styles.container}>
        {/* 顶部图标 */}
        <View style={styles.iconContainer}>
          {isDownloaded ? (
            <CheckCircle2 color="#22c55e" size={48} strokeWidth={1.5} />
          ) : (
            <AlertTriangle color="#f97316" size={48} strokeWidth={1.5} />
          )}
        </View>

        {/* 标题 */}
        <Text style={styles.title}>
          {isDownloaded ? '下载完成' : '发现重要版本更新'}
        </Text>

        {/* 更新说明 */}
        <Text style={styles.description}>
          {releaseNotes || '当前版本已不再支持，请立即升级以继续使用。'}
        </Text>

        {/* 下载中进度状态 */}
        {isDownloading && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBackground}>
              <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
            </View>
            <View style={styles.progressTextRow}>
              <Text style={styles.progressPercentText}>{progress}%</Text>
              <Text style={styles.progressSizeText}>{downloadSizeText || '正在下载安装包…'}</Text>
            </View>
          </View>
        )}

        {/* 错误提示 */}
        {!!errorMsg && (
          <Text style={styles.errorText}>{errorMsg}</Text>
        )}

        {/* 主操作按钮 */}
        <TouchableOpacity
          style={[styles.downloadButton, isDownloading && styles.downloadButtonDisabled]}
          onPress={handleStartUpdate}
          disabled={isDownloading}
          activeOpacity={0.8}
        >
          {isDownloading ? (
            <>
              <ActivityIndicator color="#ffffff" size="small" />
              <Text style={styles.downloadButtonText}>正在下载更新 ({progress}%)</Text>
            </>
          ) : isDownloaded ? (
            <>
              <RefreshCw color="#ffffff" size={18} />
              <Text style={styles.downloadButtonText}>立即安装新版本</Text>
            </>
          ) : (
            <>
              <Download color="#ffffff" size={18} />
              <Text style={styles.downloadButtonText}>一键下载并安装</Text>
            </>
          )}
        </TouchableOpacity>

        {/* 浏览器备用兜底下载通道 */}
        <TouchableOpacity style={styles.browserFallbackButton} onPress={handleOpenInBrowser} activeOpacity={0.7}>
          <ExternalLink color="#71717a" size={14} />
          <Text style={styles.browserFallbackText}>在系统浏览器中下载安装包</Text>
        </TouchableOpacity>

        {/* 底部小字说明 */}
        <Text style={styles.hint}>完成安装后重新打开应用即可正常体验</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 300,
  },
  progressContainer: {
    width: '100%',
    maxWidth: 280,
    marginBottom: 24,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#f97316',
    borderRadius: 4,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPercentText: {
    fontSize: 12,
    color: '#f97316',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  progressSizeText: {
    fontSize: 12,
    color: '#71717a',
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 280,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f97316',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 16,
    minWidth: 240,
  },
  downloadButtonDisabled: {
    backgroundColor: '#9a3412',
  },
  downloadButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  browserFallbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  browserFallbackText: {
    fontSize: 13,
    color: '#71717a',
  },
  hint: {
    fontSize: 11,
    color: '#3f3f46',
    marginTop: 16,
    textAlign: 'center',
  },
});
