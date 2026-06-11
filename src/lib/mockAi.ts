import type { ChatMessage, ChatResponse, ResponseChoice } from '../types/chat';

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

function createFirstTurnChoices(hasTension: boolean): ResponseChoice[] {
  if (hasTension) {
    return [
      {
        id: 'A',
        label: '确认这份惑',
        description: '这份整理基本准确，可以沿着这个张力继续分析。',
        meaning: 'confirm_huo_as_mapped',
        client_followup: '好，我们先沿着这份“惑”继续。你可以补一句：这两个方向里，哪一个对你更难放下？',
        requires_api_after_choice: false,
      },
      {
        id: 'B',
        label: '修改重点',
        description: '这份整理有一部分准确，但真正困扰我的重点不在这里。',
        meaning: 'revise_huo_focus',
        client_followup: '可以。请直接改写不准确的那一部分，尤其是“真正困扰我的其实是……”。',
        requires_api_after_choice: false,
      },
      {
        id: 'C',
        label: '先定义概念',
        description: '我想先弄清一个关键词的意思，再继续分析。',
        meaning: 'clarify_key_concept_first',
        client_followup: '好，我们先做概念澄清。你想先定义哪个词？可以只写一个词。',
        requires_api_after_choice: false,
      },
      {
        id: 'D',
        label: '我自己写',
        description: '这些选项都不准确，我想重新描述这个困惑。',
        meaning: 'free_rewrite',
        client_followup: '可以。直接写下你更准确的版本，不需要写得完整。',
        requires_api_after_choice: false,
      },
    ];
  }

  return [
    {
      id: 'A',
      label: '具体情境',
      description: '我想先补充这件事发生在什么场景里。',
      meaning: 'add_concrete_context',
      client_followup: '好，先补具体情境。它通常发生在什么场景里？',
      requires_api_after_choice: false,
    },
    {
      id: 'B',
      label: '在意的行为',
      description: '我想先分析让我不安的那个行为本身。',
      meaning: 'analyze_behavior_itself',
      client_followup: '好，我们先看行为本身。那个让你卡住的行为具体是什么？',
      requires_api_after_choice: false,
    },
    {
      id: 'C',
      label: '背后含义',
      description: '我想先分析这个行为背后可能意味着什么。',
      meaning: 'analyze_implied_meaning',
      client_followup: '好，我们先看背后含义。你最担心它代表什么？',
      requires_api_after_choice: false,
    },
    {
      id: 'D',
      label: '我自己写',
      description: '这些选项都不准确，我想重新描述这个困惑。',
      meaning: 'free_rewrite',
      client_followup: '可以。直接写下你更准确的版本，不需要写得完整。',
      requires_api_after_choice: false,
    },
  ];
}

function firstTurnResponse(beliefs: string[], tensions: string[]) {
  if (beliefs.length >= 2) {
    const tensionLine = tensions[0] ? `，而它们之间似乎有一个张力：${tensions[0]}` : '';
    return {
      mapping: `我先把你的问题整理成一个“惑”：你一方面重视「${beliefs[0]}」，另一方面也重视「${beliefs[1]}」${tensionLine}。`,
      question: '这份整理更接近哪一种情况？',
      hasTension: tensions.length > 0,
      choices: createFirstTurnChoices(tensions.length > 0),
    };
  }

  return {
    mapping: '我先把你的表达当作一个尚未成形的“惑”：这里可能已经有一个困扰你的判断，但具体情境、行为或背后含义还没有完全显出来。',
    question: '你想先补哪一层？',
    hasTension: false,
    choices: createFirstTurnChoices(false),
  };
}

function followUpResponse(text: string, beliefs: string[], tensions: string[], turnCount: number) {
  if (tensions.length > 0) {
    const options = [
      {
        mapping: `这里已经出现一个张力：${tensions[0]}。`,
        question: '如果先不急着选择，你觉得这两个信念各自依赖的理由分别是什么？',
      },
      {
        mapping: `我们先停在这个张力上：${tensions[0]}。`,
        question: '在你的理解里，哪一边更像价值判断，哪一边更像现实限制？',
      },
      {
        mapping: `这个冲突目前可以表述为：${tensions[0]}。`,
        question: '如果要继续澄清，你觉得哪个关键词最需要先被定义清楚？',
      },
    ];
    return { ...options[turnCount % options.length], hasTension: true };
  }

  if (beliefs.length >= 2) {
    return {
      mapping: `目前看起来，你至少同时持有「${beliefs[0]}」和「${beliefs[1]}」。`,
      question: '这两个信念在你的处境里是互相支持，还是正在把你推向不同方向？',
      hasTension: false,
    };
  }

  if (/应该|必须|不得不/.test(text)) {
    return {
      mapping: '你用了「应该」这一类词，它通常暗示某个尚未展开的价值或责任来源。',
      question: '这里的「应该」更像是你自己的价值判断，还是来自他人期待或某种责任？',
      hasTension: false,
    };
  }

  if (turnCount >= 4) {
    return {
      mapping: '我们可以再往下分一层：这个困惑里可能同时有事实判断和价值判断。',
      question: '你愿意先挑一个最核心的判断说清楚吗？',
      hasTension: false,
    };
  }

  return {
    mapping: '我先不把这个问题扩大，而是把它收窄到一个信念上。',
    question: '在这件事里，你最不愿意放弃的那个信念是什么？',
    hasTension: false,
  };
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
    phase: 'summary',
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
    mapping: null,
    question: null,
    response_mode: 'free_text',
    choices: [],
    allow_free_text: true,
    detected_beliefs: safeBeliefs,
    detected_tensions: safeTensions,
    detected_assumptions: [],
    unclear_concepts: ['这些信念各自依赖的理由', '尚未被说清楚的关键概念'],
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
      phase: 'crisis',
      message:
        '我注意到你现在可能正在经历的不只是思想上的困惑。思想分析在这个时刻可能不是你最需要的。请优先联系你所在地的专业心理健康支持机构、可信任的人，或当地紧急服务。',
      mapping: null,
      question: null,
      response_mode: 'free_text',
      choices: [],
      allow_free_text: false,
      detected_beliefs: previousBeliefs,
      detected_tensions: previousTensions,
      detected_assumptions: [],
      unclear_concepts: [],
      can_summarize: false,
      should_summarize: false,
    };
  }

  const userTurns = history.filter((message) => message.role === 'user').length + 1;
  const detectedBeliefs = detectBeliefs(text, previousBeliefs);
  const detectedTensions = detectTensions(detectedBeliefs, previousTensions);
  const canSummarize = userTurns >= 5 && detectedBeliefs.length >= 2 && detectedTensions.length >= 1;
  const shouldSummarize = userTurns >= 8 || (userTurns >= 5 && canSummarize);

  const answer: {
    mapping: string;
    question: string;
    hasTension: boolean;
    choices?: ResponseChoice[];
  } =
    userTurns === 1
      ? firstTurnResponse(detectedBeliefs, detectedTensions)
      : followUpResponse(text, detectedBeliefs, detectedTensions, userTurns);

  return {
    response_type: 'normal',
    risk_level: 'none',
    phase: answer.hasTension ? 'tension_analysis' : userTurns === 1 ? 'mapping' : 'clarification',
    message: `${answer.mapping}\n\n${answer.question}`,
    mapping: answer.mapping,
    question: answer.question,
    response_mode: userTurns === 1 && answer.choices?.length ? 'choice' : 'free_text',
    choices: userTurns === 1 ? (answer.choices ?? []) : [],
    allow_free_text: true,
    has_tension: answer.hasTension,
    detected_beliefs: detectedBeliefs,
    detected_tensions: detectedTensions,
    detected_assumptions: [],
    unclear_concepts: answer.hasTension ? ['张力双方各自依赖的理由'] : ['最核心的信念或概念'],
    can_summarize: canSummarize,
    should_summarize: shouldSummarize,
  };
}
