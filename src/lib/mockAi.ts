import type { ChatMessage, ChatResponse } from '../types/chat';

const crisisPatterns = [
  /不想活|自杀|轻生|结束生命|伤害自己|伤害别人|杀了|去死/,
  /今晚之后|最后一次|不用再纠结|已经想清楚了.*不需要|告别/,
];

const conceptHints = [
  { test: /父母|家人|家庭|陪伴/, belief: '陪伴家人是重要的' },
  { test: /大城市|发展|事业|职业|机会/, belief: '追求个人发展是重要的' },
  { test: /诚实|说真话|坦白/, belief: '诚实表达是重要的' },
  { test: /伤害|难过|关系|朋友/, belief: '维护关系或避免伤害他人是重要的' },
  { test: /努力|回报|公平/, belief: '努力应当带来相应回报' },
  { test: /自由|独立|自己选择|自主选择/, belief: '自主选择是重要的' },
  { test: /责任|义务|应该/, belief: '某种责任或义务需要被承担' },
];

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function detectBeliefs(text: string, previous: string[]) {
  const next = [...previous];
  for (const hint of conceptHints) {
    if (hint.test.test(text)) {
      next.push(hint.belief);
    }
  }
  if (next.length === previous.length && text.length > 10) {
    next.push(`用户重视「${text.slice(0, 14)}${text.length > 14 ? '…' : ''}」背后的理由`);
  }
  return unique(next).slice(0, 5);
}

function detectTensions(beliefs: string[], previous: string[]) {
  const next = [...previous];
  const hasFamily = beliefs.includes('陪伴家人是重要的');
  const hasCareer = beliefs.includes('追求个人发展是重要的');
  const hasHonesty = beliefs.includes('诚实表达是重要的');
  const hasCare = beliefs.includes('维护关系或避免伤害他人是重要的');
  const hasAutonomy = beliefs.includes('自主选择是重要的');
  const hasDuty = beliefs.includes('某种责任或义务需要被承担');

  if (hasFamily && hasCareer) {
    next.push('家庭陪伴与个人发展在具体选择上发生张力');
  }
  if (hasHonesty && hasCare) {
    next.push('诚实表达与避免伤害他人在表达方式上发生张力');
  }
  if (hasAutonomy && hasDuty) {
    next.push('自主选择与责任义务之间存在张力');
  }
  return unique(next).slice(0, 4);
}

function hasCrisisSignal(text: string) {
  return crisisPatterns.some((pattern) => pattern.test(text));
}

function firstTurnResponse(beliefs: string[], tensions: string[]): string {
  if (beliefs.length >= 2) {
    const tensionLine = tensions[0] ? `，而它们之间似乎有一个张力：${tensions[0]}` : '';
    return `谢谢你把这个问题带来。让我先确认我理解得是否准确：你一方面重视「${beliefs[0]}」，另一方面也重视「${beliefs[1]}」${tensionLine}。我理解得对吗？`;
  }

  return '谢谢你把这个问题带来。让我先确认我理解得是否准确：你现在困扰的不是一个孤立想法，而是几个想法之间还没有被说清楚的关系。我理解得对吗？';
}

function followUpResponse(text: string, beliefs: string[], tensions: string[], turnCount: number): string {
  if (tensions.length > 0) {
    const options = [
      `我注意到这里已经出现一个张力：${tensions[0]}。如果先不急着选择，你觉得这两个信念各自依赖的理由分别是什么？`,
      `我们先停在这个张力上：${tensions[0]}。在你的理解里，哪一边更像价值判断，哪一边更像现实限制？`,
      `这个冲突目前可以表述为：${tensions[0]}。如果要继续澄清，你觉得哪个关键词最需要先被定义清楚？`,
    ];
    return options[turnCount % options.length];
  }

  if (beliefs.length >= 2) {
    return `目前看起来，你至少同时持有「${beliefs[0]}」和「${beliefs[1]}」。这两个信念在你的处境里是互相支持，还是正在把你推向不同方向？`;
  }

  if (/应该|必须|不得不/.test(text)) {
    return `你用了「应该」这一类词。这里的「应该」更像是你自己的价值判断，还是来自他人期待或某种责任？`;
  }

  if (turnCount >= 4) {
    return '我们可以再往下分一层：这个困惑里，哪些是事实判断，哪些是价值判断？你愿意先挑一个最核心的判断说清楚吗？';
  }

  return '我想先追问一个更窄的问题：在这件事里，你最不愿意放弃的那个信念是什么？';
}

export function generateSummary(beliefs: string[], tensions: string[]): ChatResponse {
  const safeBeliefs = beliefs.length
    ? beliefs
    : ['你正在尝试澄清一个尚未完全成形的核心信念'];
  const safeTensions = tensions.length
    ? tensions
    : ['目前的张力还需要通过进一步追问来确认'];

  return {
    response_type: 'summary',
    risk_level: 'none',
    message: [
      '我们目前整理出的结构是：',
      '',
      '1. 你的核心信念',
      ...safeBeliefs.map((belief) => `- ${belief}`),
      '',
      '2. 它们之间的张力',
      ...safeTensions.map((tension) => `- ${tension}`),
      '',
      '3. 仍需澄清的问题',
      '- 这些信念各自依赖的理由是什么？',
      '- 哪个概念还没有被说清楚？',
      '',
      '4. 这次对话暂时抵达的位置',
      '- 你现在不是缺少一个现成答案，而是需要继续区分这些信念之间的关系。',
    ].join('\n'),
    detected_beliefs: safeBeliefs,
    detected_tensions: safeTensions,
    can_summarize: true,
    should_summarize: false,
  };
}

export function mockChatResponse(
  text: string,
  history: ChatMessage[],
  previousBeliefs: string[],
  previousTensions: string[],
): ChatResponse {
  if (hasCrisisSignal(text)) {
    return {
      response_type: 'crisis',
      risk_level: 'high',
      message:
        '我注意到你现在可能正在经历的不只是思想上的困惑。思想分析在这个时刻可能不是你最需要的。请优先联系你所在地的专业心理健康支持机构、可信任的人，或当地紧急服务。',
      detected_beliefs: previousBeliefs,
      detected_tensions: previousTensions,
      can_summarize: false,
      should_summarize: false,
    };
  }

  const userTurns = history.filter((message) => message.role === 'user').length + 1;
  const detectedBeliefs = detectBeliefs(text, previousBeliefs);
  const detectedTensions = detectTensions(detectedBeliefs, previousTensions);
  const canSummarize = userTurns >= 5 && detectedBeliefs.length >= 2 && detectedTensions.length >= 1;
  const shouldSummarize = userTurns >= 8 || (userTurns >= 5 && canSummarize);

  return {
    response_type: 'normal',
    risk_level: 'none',
    message:
      userTurns === 1
        ? firstTurnResponse(detectedBeliefs, detectedTensions)
        : followUpResponse(text, detectedBeliefs, detectedTensions, userTurns),
    detected_beliefs: detectedBeliefs,
    detected_tensions: detectedTensions,
    can_summarize: canSummarize,
    should_summarize: shouldSummarize,
  };
}
