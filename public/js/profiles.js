/** 플랫폼별 생성/내보내기 프로필과 비용 추정. */
(function () {
  "use strict";

  const PROFILES = Object.freeze({
    generic: {
      label: "일반 PNG/APNG",
      counts: [10, 12, 15],
      formats: ["static", "animated-local", "animated-ai"],
      width: 360,
      height: 360,
      maxBytes: 0,
      animated: { frameCount: 6, delayMs: 150, plays: 0 },
    },
    "kakao-static": {
      label: "카카오 정지 시안",
      counts: [32],
      formats: ["static"],
      width: 360,
      height: 360,
      maxBytes: 150 * 1024,
      animated: null,
    },
    "line-static": {
      label: "LINE 정지 스티커",
      counts: [8, 16, 24],
      formats: ["static"],
      width: 370,
      height: 320,
      maxBytes: 1024 * 1024,
      animated: null,
    },
    "line-animated": {
      label: "LINE 애니메이션 스티커",
      counts: [8, 16, 24],
      formats: ["animated-local", "animated-ai"],
      width: 320,
      height: 270,
      maxBytes: 1024 * 1024,
      animated: { frameCount: 6, delayMs: 150, plays: 4, minFrames: 5, maxFrames: 20 },
    },
    "telegram-static": {
      label: "Telegram 정지 스티커",
      counts: [10, 12, 15],
      formats: ["static"],
      width: 512,
      height: 512,
      maxBytes: 512 * 1024,
      animated: null,
    },
  });

  function get(key) {
    return PROFILES[key] || PROFILES.generic;
  }

  function estimate({ count, format, hasReference }) {
    const frames = format === "animated-ai" ? 6 : 1;
    const canonicalCalls = hasReference ? 0 : 1;
    const imageCalls = canonicalCalls + count * frames;
    const referenceCalls = count * frames;
    const neurons = imageCalls * 104.2 + referenceCalls * 5.37 + 50;
    return {
      imageCalls,
      referenceCalls,
      neurons: Math.round(neurons * 10) / 10,
    };
  }

  function validateSelection(profileKey, count, format) {
    const profile = get(profileKey);
    const issues = [];
    if (!profile.counts.includes(Number(count))) issues.push("이 플랫폼이 지원하는 세트 개수가 아니에요.");
    if (!profile.formats.includes(format)) issues.push("이 플랫폼에서 지원하지 않는 형식이에요.");
    return issues;
  }

  function validateFile(profileKey, byteLength, frameCount = 0) {
    const profile = get(profileKey);
    const issues = [];
    if (profile.maxBytes && byteLength > profile.maxBytes) {
      issues.push(`파일이 제한 ${(profile.maxBytes / 1024).toFixed(0)}KB를 초과해요.`);
    }
    if (profile.animated) {
      const min = profile.animated.minFrames || 1;
      const max = profile.animated.maxFrames || Infinity;
      if (frameCount < min || frameCount > max) issues.push(`프레임 수가 ${min}~${max} 범위를 벗어났어요.`);
    }
    return issues;
  }

  window.ExportProfiles = { all: PROFILES, estimate, get, validateFile, validateSelection };
})();
