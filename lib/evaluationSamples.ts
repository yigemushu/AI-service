import type { AnalyzeApiResponse, BusinessType } from "@/lib/types";

export type EvaluationMetric =
  | "商品/服务识别"
  | "数量识别"
  | "地址/时间识别"
  | "缺失信息完整"
  | "风险点合理"
  | "回复可直接发"
  | "订单状态正确";

export type EvaluationSample = {
  id: string;
  businessType: BusinessType;
  sampleGroup?: "基础" | "刁钻";
  title: string;
  message: string;
  expected: {
    itemKeywords: string[];
    quantityKeywords: string[];
    addressOrTimeKeywords: string[];
    missingKeywords: string[];
    riskKeywords: string[];
    status: string;
  };
};

export type EvaluationScore = {
  sampleId: string;
  total: number;
  metrics: Record<EvaluationMetric, boolean>;
  notes: string[];
};

export const evaluationMetrics: EvaluationMetric[] = [
  "商品/服务识别",
  "数量识别",
  "地址/时间识别",
  "缺失信息完整",
  "风险点合理",
  "回复可直接发",
  "订单状态正确",
];

export const evaluationSamples: EvaluationSample[] = [
  { id: "sam-01", businessType: "sam", title: "山姆代下单-混合商品", message: "姐，瑞士卷一盒，牛肉卷2个，能不能今天下午送青秀区万象城？电话我等下发。", expected: { itemKeywords: ["瑞士卷", "牛肉卷"], quantityKeywords: ["1", "2"], addressOrTimeKeywords: ["青秀区", "今天下午"], missingKeywords: ["联系方式"], riskKeywords: ["库存", "配送"], status: "待补充" } },
  { id: "sam-02", businessType: "sam", title: "山姆代下单-只有语音转文字口吻", message: "帮我带那个烤鸡，还有麻薯两盒，晚上七点前可以到吗，地址还是凤岭北。", expected: { itemKeywords: ["烤鸡", "麻薯"], quantityKeywords: ["2"], addressOrTimeKeywords: ["凤岭北", "晚上七点"], missingKeywords: ["联系方式"], riskKeywords: ["时效", "库存"], status: "待补充" } },
  { id: "sam-03", businessType: "sam", title: "山姆代下单-缺地址", message: "我要鸡胸肉3包和蛋糕一个，今天能送就下单，价格多少？", expected: { itemKeywords: ["鸡胸肉", "蛋糕"], quantityKeywords: ["3", "1"], addressOrTimeKeywords: ["今天"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["价格", "库存"], status: "待补充" } },
  { id: "sam-04", businessType: "sam", title: "山姆代下单-询问替代", message: "牛肉卷如果没有就换烤鸡，先要两个，明天下午送民族大道这边，手机 13800001111。", expected: { itemKeywords: ["牛肉卷", "烤鸡"], quantityKeywords: ["2"], addressOrTimeKeywords: ["明天下午", "民族大道"], missingKeywords: [], riskKeywords: ["替代", "库存"], status: "待确认" } },
  { id: "sam-05", businessType: "sam", title: "山姆代下单-生日场景", message: "小孩生日，想要蛋糕1个，瑞士卷2盒，周六上午送到航洋国际，能保证吗？", expected: { itemKeywords: ["蛋糕", "瑞士卷"], quantityKeywords: ["1", "2"], addressOrTimeKeywords: ["周六上午", "航洋国际"], missingKeywords: ["联系方式"], riskKeywords: ["不要承诺", "时效"], status: "待补充" } },
  { id: "sam-06", businessType: "sam", title: "山姆代下单-价格敏感", message: "麻薯和鸡胸肉各来一份，青秀万达，下午三点前到，大概多少钱，别太贵。", expected: { itemKeywords: ["麻薯", "鸡胸肉"], quantityKeywords: ["1"], addressOrTimeKeywords: ["青秀万达", "下午三点"], missingKeywords: ["联系方式"], riskKeywords: ["价格", "时效"], status: "待补充" } },
  { id: "sam-07", businessType: "sam", title: "山姆代下单-地址电话完整", message: "瑞士卷1盒、烤鸡1只，送东盟商务区，电话 13900002222，今晚八点前方便吗？", expected: { itemKeywords: ["瑞士卷", "烤鸡"], quantityKeywords: ["1"], addressOrTimeKeywords: ["东盟商务区", "今晚八点"], missingKeywords: [], riskKeywords: ["库存", "配送"], status: "待确认" } },
  { id: "sam-08", businessType: "sam", title: "山姆代下单-模糊商品", message: "上次那个小甜点还有吗？要两盒，今天送老地方，电话你有。", expected: { itemKeywords: ["甜点"], quantityKeywords: ["2"], addressOrTimeKeywords: ["今天"], missingKeywords: ["商品", "地址"], riskKeywords: ["商品", "库存"], status: "待补充" } },
  { id: "sam-09", businessType: "sam", title: "山姆代下单-多件数量口语", message: "牛肉卷来仨，鸡胸肉来两包，送会展中心附近，明天上午可以不？", expected: { itemKeywords: ["牛肉卷", "鸡胸肉"], quantityKeywords: ["3", "2"], addressOrTimeKeywords: ["会展中心", "明天上午"], missingKeywords: ["联系方式"], riskKeywords: ["时效", "库存"], status: "待补充" } },
  { id: "sam-10", businessType: "sam", title: "山姆代下单-催单", message: "我昨天说的烤鸡和麻薯还没买吗？今天中午前还能安排吗？", expected: { itemKeywords: ["烤鸡", "麻薯"], quantityKeywords: [], addressOrTimeKeywords: ["今天中午"], missingKeywords: ["数量", "地址", "联系方式"], riskKeywords: ["催单", "时效"], status: "待补充" } },
  { id: "sam-11", businessType: "sam", title: "山姆代下单-缺价格确认", message: "瑞士卷三盒，公司团购，送金湖广场，数量先这样，价格确认了再说。", expected: { itemKeywords: ["瑞士卷"], quantityKeywords: ["3"], addressOrTimeKeywords: ["金湖广场"], missingKeywords: ["联系方式", "时间"], riskKeywords: ["价格", "团购"], status: "待补充" } },
  { id: "sam-12", businessType: "sam", title: "山姆代下单-售后", message: "刚才送来的蛋糕压坏了，能不能处理一下？我在青秀区。", expected: { itemKeywords: ["蛋糕"], quantityKeywords: [], addressOrTimeKeywords: ["青秀区"], missingKeywords: ["订单", "照片", "联系方式"], riskKeywords: ["售后", "破损"], status: "售后中" } },
  { id: "sam-13", businessType: "sam", title: "山姆代下单-只问能否买", message: "现在还能买到牛肉卷吗？如果有我想要两个，晚上送。", expected: { itemKeywords: ["牛肉卷"], quantityKeywords: ["2"], addressOrTimeKeywords: ["晚上"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["库存"], status: "待补充" } },
  { id: "sam-14", businessType: "sam", title: "山姆代下单-地址详细", message: "鸡胸肉4包，送青秀区民族大道 136 号，电话 13700003333，明天晚上。", expected: { itemKeywords: ["鸡胸肉"], quantityKeywords: ["4"], addressOrTimeKeywords: ["民族大道", "明天晚上"], missingKeywords: [], riskKeywords: ["库存", "配送"], status: "待确认" } },
  { id: "sam-15", businessType: "sam", title: "山姆代下单-临时改动", message: "刚刚说的麻薯不要了，换成瑞士卷一盒，再加牛肉卷一个，送同一个地址。", expected: { itemKeywords: ["瑞士卷", "牛肉卷"], quantityKeywords: ["1"], addressOrTimeKeywords: ["同一个地址"], missingKeywords: ["联系方式", "时间"], riskKeywords: ["改单", "库存"], status: "待补充" } },

  { id: "xianyu-01", businessType: "xianyu", title: "闲鱼-砍价包邮", message: "耳机 180 能出吗？包邮不，今天拍了什么时候发？", expected: { itemKeywords: ["耳机"], quantityKeywords: ["1"], addressOrTimeKeywords: ["今天"], missingKeywords: ["收货地"], riskKeywords: ["议价", "包邮"], status: "待确认" } },
  { id: "xianyu-02", businessType: "xianyu", title: "闲鱼-成色追问", message: "这个相机几成新？镜头有霉吗？能不能便宜 50。", expected: { itemKeywords: ["相机", "镜头"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["成色", "议价"], status: "待确认" } },
  { id: "xianyu-03", businessType: "xianyu", title: "闲鱼-急发货", message: "键盘还在吗？我急用，今晚能发顺丰吗，广东。", expected: { itemKeywords: ["键盘"], quantityKeywords: ["1"], addressOrTimeKeywords: ["今晚", "广东"], missingKeywords: [], riskKeywords: ["时效", "快递"], status: "待确认" } },
  { id: "xianyu-04", businessType: "xianyu", title: "闲鱼-多件打包", message: "鼠标和键盘一起要，打包 260 行不行，上海收。", expected: { itemKeywords: ["鼠标", "键盘"], quantityKeywords: ["1"], addressOrTimeKeywords: ["上海"], missingKeywords: [], riskKeywords: ["打包", "议价"], status: "待确认" } },
  { id: "xianyu-05", businessType: "xianyu", title: "闲鱼-真假风险", message: "这双鞋正品吗？盒子小票还在不，能走验货宝吗？", expected: { itemKeywords: ["鞋"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["尺码", "收货地"], riskKeywords: ["正品", "验货"], status: "待补充" } },
  { id: "xianyu-06", businessType: "xianyu", title: "闲鱼-售后争议", message: "我收到耳机左边没声音，申请退款可以吗？", expected: { itemKeywords: ["耳机"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["订单", "视频"], riskKeywords: ["售后", "退款"], status: "售后中" } },
  { id: "xianyu-07", businessType: "xianyu", title: "闲鱼-只问最低价", message: "最低多少，合适我现在拍，浙江。", expected: { itemKeywords: ["待确认商品"], quantityKeywords: [], addressOrTimeKeywords: ["浙江"], missingKeywords: ["商品"], riskKeywords: ["最低价", "议价"], status: "待补充" } },
  { id: "xianyu-08", businessType: "xianyu", title: "闲鱼-配件确认", message: "平板还有笔和壳吗？电池健康多少，包邮到成都吗？", expected: { itemKeywords: ["平板", "笔", "壳"], quantityKeywords: ["1"], addressOrTimeKeywords: ["成都"], missingKeywords: [], riskKeywords: ["配件", "包邮"], status: "待确认" } },
  { id: "xianyu-09", businessType: "xianyu", title: "闲鱼-自提", message: "显示器还在的话我晚上自提，地铁口方便吗？", expected: { itemKeywords: ["显示器"], quantityKeywords: ["1"], addressOrTimeKeywords: ["晚上", "地铁口"], missingKeywords: ["联系方式"], riskKeywords: ["自提", "时间"], status: "待补充" } },
  { id: "xianyu-10", businessType: "xianyu", title: "闲鱼-邮费确认", message: "书一套都在吗？新疆邮费怎么算，能不能发邮政。", expected: { itemKeywords: ["书"], quantityKeywords: ["1套"], addressOrTimeKeywords: ["新疆"], missingKeywords: [], riskKeywords: ["邮费", "偏远地区"], status: "待确认" } },
  { id: "xianyu-11", businessType: "xianyu", title: "闲鱼-小刀", message: "Switch 可以小刀吗？手柄漂移不，明天能发吗？", expected: { itemKeywords: ["Switch", "手柄"], quantityKeywords: ["1"], addressOrTimeKeywords: ["明天"], missingKeywords: ["收货地"], riskKeywords: ["议价", "成色"], status: "待补充" } },
  { id: "xianyu-12", businessType: "xianyu", title: "闲鱼-确认型号", message: "你这个 iPhone 是 128 还是 256，电池多少，价格还能谈吗？", expected: { itemKeywords: ["iPhone"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["型号", "收货地"], riskKeywords: ["型号", "议价"], status: "待补充" } },
  { id: "xianyu-13", businessType: "xianyu", title: "闲鱼-拍下提醒", message: "我拍下了，麻烦今天寄出，地址平台有。", expected: { itemKeywords: ["待确认商品"], quantityKeywords: [], addressOrTimeKeywords: ["今天"], missingKeywords: ["商品"], riskKeywords: ["发货", "平台地址"], status: "处理中" } },
  { id: "xianyu-14", businessType: "xianyu", title: "闲鱼-换货不支持", message: "衣服 M 码偏大吗？不合适能退吗？", expected: { itemKeywords: ["衣服"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["退货", "尺码"], status: "待确认" } },
  { id: "xianyu-15", businessType: "xianyu", title: "闲鱼-组合商品", message: "咖啡机加两个滤芯一起多少钱？包邮广州的话我现在拍。", expected: { itemKeywords: ["咖啡机", "滤芯"], quantityKeywords: ["2"], addressOrTimeKeywords: ["广州"], missingKeywords: [], riskKeywords: ["包邮", "价格"], status: "待确认" } },

  { id: "local-01", businessType: "local", title: "本地服务-空调清洗", message: "明天下午想约清洗空调，两台挂机，青秀区，有电梯，多少钱？", expected: { itemKeywords: ["清洗空调", "挂机"], quantityKeywords: ["2"], addressOrTimeKeywords: ["明天下午", "青秀区"], missingKeywords: ["联系方式"], riskKeywords: ["报价", "上门"], status: "待补充" } },
  { id: "local-02", businessType: "local", title: "本地服务-保洁", message: "周六上午 90 平开荒保洁，江南区，能安排几个人？", expected: { itemKeywords: ["开荒保洁"], quantityKeywords: ["90"], addressOrTimeKeywords: ["周六上午", "江南区"], missingKeywords: ["联系方式"], riskKeywords: ["排期", "报价"], status: "待补充" } },
  { id: "local-03", businessType: "local", title: "本地服务-维修", message: "洗衣机不排水，今晚能上门看吗？在五象新区。", expected: { itemKeywords: ["洗衣机维修"], quantityKeywords: ["1"], addressOrTimeKeywords: ["今晚", "五象新区"], missingKeywords: ["联系方式", "型号"], riskKeywords: ["上门", "故障"], status: "待补充" } },
  { id: "local-04", businessType: "local", title: "本地服务-搬家", message: "月底搬家，从凤岭到西乡塘，一房一厅，大概报价？", expected: { itemKeywords: ["搬家"], quantityKeywords: ["一房一厅"], addressOrTimeKeywords: ["月底", "凤岭", "西乡塘"], missingKeywords: ["联系方式", "楼层"], riskKeywords: ["报价", "距离"], status: "待补充" } },
  { id: "local-05", businessType: "local", title: "本地服务-美甲预约", message: "今天晚上还有美甲位置吗？想做猫眼，万象城附近。", expected: { itemKeywords: ["美甲", "猫眼"], quantityKeywords: ["1"], addressOrTimeKeywords: ["今天晚上", "万象城"], missingKeywords: ["联系方式"], riskKeywords: ["档期", "价格"], status: "待补充" } },
  { id: "local-06", businessType: "local", title: "本地服务-家教", message: "小学数学一对一，周三周五晚上，青秀区上门，老师怎么收费？", expected: { itemKeywords: ["小学数学", "家教"], quantityKeywords: ["1对1"], addressOrTimeKeywords: ["周三", "周五晚上", "青秀区"], missingKeywords: ["联系方式"], riskKeywords: ["老师", "报价"], status: "待补充" } },
  { id: "local-07", businessType: "local", title: "本地服务-宠物洗护", message: "柯基洗澡加修毛，明天上午可以吗？在良庆区。", expected: { itemKeywords: ["宠物洗护", "修毛"], quantityKeywords: ["1"], addressOrTimeKeywords: ["明天上午", "良庆区"], missingKeywords: ["联系方式"], riskKeywords: ["宠物", "排期"], status: "待补充" } },
  { id: "local-08", businessType: "local", title: "本地服务-摄影", message: "公司活动拍摄 3 小时，下周二下午，在会展中心，报价发我。", expected: { itemKeywords: ["活动拍摄"], quantityKeywords: ["3小时"], addressOrTimeKeywords: ["下周二下午", "会展中心"], missingKeywords: ["联系方式"], riskKeywords: ["报价", "档期"], status: "待补充" } },
  { id: "local-09", businessType: "local", title: "本地服务-售后投诉", message: "昨天清洗完空调还是有异味，能重新上门处理吗？", expected: { itemKeywords: ["空调清洗"], quantityKeywords: ["1"], addressOrTimeKeywords: ["昨天"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["售后", "返工"], status: "售后中" } },
  { id: "local-10", businessType: "local", title: "本地服务-时间地点完整", message: "后天下午两点，民族大道 100 号，空调深度清洗 1 台，电话 13600004444。", expected: { itemKeywords: ["空调深度清洗"], quantityKeywords: ["1"], addressOrTimeKeywords: ["后天下午两点", "民族大道"], missingKeywords: [], riskKeywords: ["上门", "确认"], status: "待确认" } },

  { id: "trade-01", businessType: "trade", title: "外贸-标准询价", message: "Hi, we need 500 stainless steel water bottles. Please quote FOB Ningbo and lead time to Malaysia.", expected: { itemKeywords: ["stainless steel water bottles"], quantityKeywords: ["500"], addressOrTimeKeywords: ["Malaysia", "lead time"], missingKeywords: ["specification"], riskKeywords: ["FOB", "MOQ"], status: "待报价" } },
  { id: "trade-02", businessType: "trade", title: "外贸-MOQ 试单", message: "Can we start with 80 pcs yoga mats? Ship to Germany, need logo printing price.", expected: { itemKeywords: ["yoga mats"], quantityKeywords: ["80"], addressOrTimeKeywords: ["Germany"], missingKeywords: ["trade terms"], riskKeywords: ["MOQ", "logo"], status: "待报价" } },
  { id: "trade-03", businessType: "trade", title: "外贸-缺数量", message: "We are interested in your LED desk lamp. What is the best price to UAE?", expected: { itemKeywords: ["LED desk lamp"], quantityKeywords: [], addressOrTimeKeywords: ["UAE"], missingKeywords: ["quantity", "trade terms"], riskKeywords: ["price", "quantity"], status: "待补充" } },
  { id: "trade-04", businessType: "trade", title: "外贸-急交期", message: "Need 2,000 custom tote bags before July 10, CIF Los Angeles. Can you confirm?", expected: { itemKeywords: ["custom tote bags"], quantityKeywords: ["2000"], addressOrTimeKeywords: ["July 10", "Los Angeles"], missingKeywords: ["specification"], riskKeywords: ["delivery", "CIF"], status: "待报价" } },
  { id: "trade-05", businessType: "trade", title: "外贸-样品", message: "Could you send samples of bamboo toothbrush? We may order 10,000 pcs after approval.", expected: { itemKeywords: ["bamboo toothbrush"], quantityKeywords: ["10000"], addressOrTimeKeywords: [], missingKeywords: ["destination", "trade terms"], riskKeywords: ["sample", "approval"], status: "待补充" } },
  { id: "trade-06", businessType: "trade", title: "外贸-包装规格", message: "Quote 1,500 ceramic mugs with color box, DDP Canada if possible.", expected: { itemKeywords: ["ceramic mugs"], quantityKeywords: ["1500"], addressOrTimeKeywords: ["Canada"], missingKeywords: ["delivery time"], riskKeywords: ["DDP", "packaging"], status: "待报价" } },
  { id: "trade-07", businessType: "trade", title: "外贸-低于 MOQ", message: "We only need 30 pcs for first order of pet carriers. Can you accept?", expected: { itemKeywords: ["pet carriers"], quantityKeywords: ["30"], addressOrTimeKeywords: [], missingKeywords: ["destination", "trade terms"], riskKeywords: ["MOQ", "low quantity"], status: "待补充" } },
  { id: "trade-08", businessType: "trade", title: "外贸-目的港明确", message: "Please quote 3,000 silicone lunch boxes, FOB Shenzhen, destination port Rotterdam.", expected: { itemKeywords: ["silicone lunch boxes"], quantityKeywords: ["3000"], addressOrTimeKeywords: ["Rotterdam", "FOB Shenzhen"], missingKeywords: ["delivery time"], riskKeywords: ["FOB", "port"], status: "待报价" } },
  { id: "trade-09", businessType: "trade", title: "外贸-售后质量", message: "The last shipment of 200 umbrellas had broken handles. How will you solve it?", expected: { itemKeywords: ["umbrellas"], quantityKeywords: ["200"], addressOrTimeKeywords: [], missingKeywords: ["photos", "order number"], riskKeywords: ["quality", "after-sales"], status: "售后中" } },
  { id: "trade-10", businessType: "trade", title: "外贸-只问目录", message: "Send me catalog and price list for camping chairs. We sell in Australia.", expected: { itemKeywords: ["camping chairs"], quantityKeywords: [], addressOrTimeKeywords: ["Australia"], missingKeywords: ["quantity", "trade terms"], riskKeywords: ["price list", "market"], status: "待补充" } },

  { id: "edge-sam-01", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-无人配送责任", message: "我不在家，你放门口拍照就行。瑞士卷2盒、烤鸡1只，万象城公寓，今天晚点到也行，丢了你们负责吗？", expected: { itemKeywords: ["瑞士卷", "烤鸡"], quantityKeywords: ["2", "1"], addressOrTimeKeywords: ["万象城", "今天"], missingKeywords: ["联系方式", "门牌"], riskKeywords: ["无人配送", "责任"], status: "待补充" } },
  { id: "edge-sam-02", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-冷链温控", message: "要那个冷冻牛排两袋和蛋糕一个，送到公司前台，下午开会没人拿，能保证不化吗？", expected: { itemKeywords: ["牛排", "蛋糕"], quantityKeywords: ["2", "1"], addressOrTimeKeywords: ["下午", "公司前台"], missingKeywords: ["联系方式", "详细地址"], riskKeywords: ["冷链", "温控"], status: "待补充" } },
  { id: "edge-sam-03", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-指定批次日期", message: "瑞士卷要今天新到的，不要临期，顺便看下麻薯有没有当天生产的，青秀区，电话晚点给。", expected: { itemKeywords: ["瑞士卷", "麻薯"], quantityKeywords: [], addressOrTimeKeywords: ["青秀区", "今天"], missingKeywords: ["数量", "联系方式", "时间"], riskKeywords: ["日期", "临期"], status: "待补充" } },
  { id: "edge-sam-04", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-发票税号", message: "公司买 6 盒蛋糕，能开抬头和税号吗？周五上午送航洋，税号我发图片可以吗？", expected: { itemKeywords: ["蛋糕"], quantityKeywords: ["6"], addressOrTimeKeywords: ["周五上午", "航洋"], missingKeywords: ["联系方式", "发票信息"], riskKeywords: ["发票", "税号"], status: "待补充" } },
  { id: "edge-sam-05", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-会员价和小票", message: "你按会员价买吗？小票能给我吗？我要牛肉卷4个，如果实际价比你说的贵怎么算？", expected: { itemKeywords: ["牛肉卷"], quantityKeywords: ["4"], addressOrTimeKeywords: [], missingKeywords: ["地址", "联系方式", "时间"], riskKeywords: ["价格", "小票"], status: "待补充" } },
  { id: "edge-sam-06", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-缺货替代价差", message: "鸡胸肉没货就换牛肉粒，但别超过 120，下午送凤岭儿童医院，能先垫付吗？", expected: { itemKeywords: ["鸡胸肉", "牛肉粒"], quantityKeywords: [], addressOrTimeKeywords: ["下午", "凤岭儿童医院"], missingKeywords: ["数量", "联系方式"], riskKeywords: ["替代", "垫付", "价差"], status: "待补充" } },
  { id: "edge-sam-07", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-停车门禁", message: "送高层，车进不来小区，要从西门保安那里登记，烤鸡两个晚上 8 点前到。", expected: { itemKeywords: ["烤鸡"], quantityKeywords: ["2"], addressOrTimeKeywords: ["西门", "晚上 8 点"], missingKeywords: ["详细地址", "联系方式"], riskKeywords: ["门禁", "停车"], status: "待补充" } },
  { id: "edge-sam-08", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-多地址拆单", message: "同一单能不能瑞士卷送青秀，麻薯送江南？两个地址都今天，电话同一个。", expected: { itemKeywords: ["瑞士卷", "麻薯"], quantityKeywords: [], addressOrTimeKeywords: ["青秀", "江南", "今天"], missingKeywords: ["数量", "详细地址", "联系方式"], riskKeywords: ["多地址", "拆单"], status: "待补充" } },
  { id: "edge-sam-09", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-过敏忌口", message: "给老人吃，蛋糕不要含坚果的，瑞士卷也要看配料，明天上午送医院住院部。", expected: { itemKeywords: ["蛋糕", "瑞士卷"], quantityKeywords: [], addressOrTimeKeywords: ["明天上午", "医院住院部"], missingKeywords: ["数量", "联系方式", "详细地址"], riskKeywords: ["过敏", "配料"], status: "待补充" } },
  { id: "edge-sam-10", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-改地址", message: "刚才地址错了，牛肉卷1个改送民族影城后门，不要送到前门，骑手别打电话给我老婆。", expected: { itemKeywords: ["牛肉卷"], quantityKeywords: ["1"], addressOrTimeKeywords: ["民族影城后门"], missingKeywords: ["联系方式", "时间"], riskKeywords: ["改地址", "隐私"], status: "待补充" } },
  { id: "edge-sam-11", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-部分退款", message: "昨天少了一盒麻薯，小票上有，能只退这一盒吗？还是下次补给我？", expected: { itemKeywords: ["麻薯"], quantityKeywords: ["1"], addressOrTimeKeywords: ["昨天"], missingKeywords: ["订单", "照片"], riskKeywords: ["少件", "退款"], status: "售后中" } },
  { id: "edge-sam-12", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-优惠券", message: "我看到 app 有满减券，你下单能不能用？如果用不了我就不要瑞士卷了。", expected: { itemKeywords: ["瑞士卷"], quantityKeywords: [], addressOrTimeKeywords: [], missingKeywords: ["数量", "地址", "联系方式", "时间"], riskKeywords: ["优惠券", "价格"], status: "待补充" } },
  { id: "edge-sam-13", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-包装破损", message: "蛋糕盒子外面不能压坏，我是送人的。万一包装破了但里面没事可以拒收吗？", expected: { itemKeywords: ["蛋糕"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["地址", "联系方式", "时间"], riskKeywords: ["包装", "拒收"], status: "待补充" } },
  { id: "edge-sam-14", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-大件搬运", message: "矿泉水 5 箱加纸巾 3 提，送 6 楼没电梯，能送上楼吗？明晚。", expected: { itemKeywords: ["矿泉水", "纸巾"], quantityKeywords: ["5", "3"], addressOrTimeKeywords: ["6 楼", "明晚"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["搬运", "无电梯"], status: "待补充" } },
  { id: "edge-sam-15", businessType: "sam", sampleGroup: "刁钻", title: "山姆刁钻-临时取消", message: "我先订烤鸡和牛肉卷，如果你到店发现要排很久，我可以临时取消吗，会不会扣钱？", expected: { itemKeywords: ["烤鸡", "牛肉卷"], quantityKeywords: [], addressOrTimeKeywords: [], missingKeywords: ["数量", "地址", "联系方式", "时间"], riskKeywords: ["取消", "排队"], status: "待补充" } },

  { id: "edge-xianyu-01", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-烟味宠物毛", message: "这件外套有烟味或者猫毛吗？我过敏，能不能近拍袖口和领口。", expected: { itemKeywords: ["外套"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["尺码", "收货地"], riskKeywords: ["气味", "宠物毛"], status: "待补充" } },
  { id: "edge-xianyu-02", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-账号锁", message: "iPad 退出 Apple ID 了吗？会不会有监管锁，序列号能给我看后四位吗？", expected: { itemKeywords: ["iPad"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["账号锁", "序列号"], status: "待确认" } },
  { id: "edge-xianyu-03", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-到付骗局风险", message: "我不走平台，顺丰到付，货到我验完再转你，可以不？", expected: { itemKeywords: ["待确认商品"], quantityKeywords: [], addressOrTimeKeywords: [], missingKeywords: ["商品", "收货地"], riskKeywords: ["脱离平台", "到付"], status: "待补充" } },
  { id: "edge-xianyu-04", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-拆封影响退货", message: "香水拆封试喷过几次？如果味道不对能退吗？", expected: { itemKeywords: ["香水"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["拆封", "退货"], status: "待确认" } },
  { id: "edge-xianyu-05", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-配件缺失", message: "相机原电原充都在吗？肩带、盒子、发票少哪个，少了能便宜多少？", expected: { itemKeywords: ["相机"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["配件", "议价"], status: "待确认" } },
  { id: "edge-xianyu-06", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-包装保护", message: "手办盒控，盒角不能磕，能不能双层纸箱加泡泡纸？运损算谁的？", expected: { itemKeywords: ["手办"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["包装", "运损"], status: "待补充" } },
  { id: "edge-xianyu-07", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-暗病测试", message: "显示器有没有坏点、亮斑、漏光？能开纯黑纯白拍个视频吗？", expected: { itemKeywords: ["显示器"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["坏点", "测试"], status: "待确认" } },
  { id: "edge-xianyu-08", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-自提验机", message: "手机我想当面验机 20 分钟，插卡、录视频、查电池，可以约地铁站吗？", expected: { itemKeywords: ["手机"], quantityKeywords: ["1"], addressOrTimeKeywords: ["地铁站"], missingKeywords: ["时间", "联系方式"], riskKeywords: ["自提", "验机"], status: "待补充" } },
  { id: "edge-xianyu-09", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-改价保留", message: "你先给我改 1 元保留，晚上我朋友确认后拍，不要卖别人。", expected: { itemKeywords: ["待确认商品"], quantityKeywords: [], addressOrTimeKeywords: ["晚上"], missingKeywords: ["商品"], riskKeywords: ["保留", "改价"], status: "待补充" } },
  { id: "edge-xianyu-10", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-偏远邮费", message: "滑雪板发西藏能走物流吗？太长会不会加钱，包装费另算吗？", expected: { itemKeywords: ["滑雪板"], quantityKeywords: ["1"], addressOrTimeKeywords: ["西藏"], missingKeywords: [], riskKeywords: ["偏远", "物流", "包装费"], status: "待确认" } },
  { id: "edge-xianyu-11", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-发票保修", message: "耳机还在保吗？电子发票能转我吗，维修记录有没有？", expected: { itemKeywords: ["耳机"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["保修", "发票"], status: "待确认" } },
  { id: "edge-xianyu-12", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-改地址后责任", message: "我拍下后想改到朋友地址，平台地址先不改，你按我聊天发的地址寄可以吗？", expected: { itemKeywords: ["待确认商品"], quantityKeywords: [], addressOrTimeKeywords: ["朋友地址"], missingKeywords: ["商品"], riskKeywords: ["平台地址", "改地址"], status: "待补充" } },
  { id: "edge-xianyu-13", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-真假鉴定", message: "包包支持中检吗？如果鉴定不通过你包退来回邮费吗？", expected: { itemKeywords: ["包包"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["鉴定", "真假", "退货"], status: "待确认" } },
  { id: "edge-xianyu-14", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-部分配件单买", message: "我只要键盘的接收器，不要键盘本体，能拆卖吗？", expected: { itemKeywords: ["键盘", "接收器"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["收货地"], riskKeywords: ["拆卖", "配件"], status: "待确认" } },
  { id: "edge-xianyu-15", businessType: "xianyu", sampleGroup: "刁钻", title: "闲鱼刁钻-签收后发现问题", message: "我签收后才发现镜头里面有灰，可以申请部分退款不退货吗？", expected: { itemKeywords: ["镜头"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["订单", "照片"], riskKeywords: ["部分退款", "签收"], status: "售后中" } },

  { id: "edge-local-01", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-上门无法进入", message: "明天师傅来装灯，如果保安不让进，等超过半小时还收费吗？我在高新区。", expected: { itemKeywords: ["装灯"], quantityKeywords: ["1"], addressOrTimeKeywords: ["明天", "高新区"], missingKeywords: ["联系方式", "详细地址"], riskKeywords: ["无法进入", "等待费"], status: "待补充" } },
  { id: "edge-local-02", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-材料费争议", message: "马桶漏水你们报价包材料吗？如果到现场说要换配件，能不能先拍照给我确认。", expected: { itemKeywords: ["马桶漏水", "维修"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["地址", "联系方式", "时间"], riskKeywords: ["材料费", "现场加价"], status: "待补充" } },
  { id: "edge-local-03", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-宠物在家", message: "保洁时家里有两只猫，不能开窗也不能用刺激性清洁剂，周日下午可以吗？", expected: { itemKeywords: ["保洁"], quantityKeywords: ["2"], addressOrTimeKeywords: ["周日下午"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["宠物", "清洁剂"], status: "待补充" } },
  { id: "edge-local-04", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-取消改期", message: "我约了今晚空调清洗，临时加班想改到后天，取消费怎么算？", expected: { itemKeywords: ["空调清洗"], quantityKeywords: ["1"], addressOrTimeKeywords: ["今晚", "后天"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["取消费", "改期"], status: "待补充" } },
  { id: "edge-local-05", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-高空风险", message: "外墙玻璃在 18 楼，窗户外侧能擦吗？需要安全绳还是你们自己带？", expected: { itemKeywords: ["外墙玻璃", "擦窗"], quantityKeywords: ["18"], addressOrTimeKeywords: ["18 楼"], missingKeywords: ["地址", "联系方式", "时间"], riskKeywords: ["高空", "安全"], status: "待补充" } },
  { id: "edge-local-06", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-老人独自在家", message: "上门维修时只有老人家在，你们师傅能不能先视频确认身份？周三上午。", expected: { itemKeywords: ["上门维修"], quantityKeywords: ["1"], addressOrTimeKeywords: ["周三上午"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["身份核验", "老人"], status: "待补充" } },
  { id: "edge-local-07", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-效果保证", message: "甲醛治理做完能保证达标吗？如果复测还超标免费重做吗？", expected: { itemKeywords: ["甲醛治理"], quantityKeywords: ["1"], addressOrTimeKeywords: [], missingKeywords: ["面积", "地址", "联系方式", "时间"], riskKeywords: ["效果保证", "复测"], status: "待补充" } },
  { id: "edge-local-08", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-夜间加价", message: "晚上 11 点能开锁吗？身份证在屋里，怎么证明是我的房子，夜间贵多少？", expected: { itemKeywords: ["开锁"], quantityKeywords: ["1"], addressOrTimeKeywords: ["晚上 11 点"], missingKeywords: ["地址", "联系方式", "身份证明"], riskKeywords: ["身份核验", "夜间加价"], status: "待补充" } },
  { id: "edge-local-09", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-返工边界", message: "上次补墙两天就裂了，这次返工还要收上门费吗？照片我发你。", expected: { itemKeywords: ["补墙", "返工"], quantityKeywords: ["1"], addressOrTimeKeywords: ["两天"], missingKeywords: ["订单", "地址", "联系方式"], riskKeywords: ["返工", "上门费"], status: "售后中" } },
  { id: "edge-local-10", businessType: "local", sampleGroup: "刁钻", title: "本地刁钻-多人同时服务", message: "办公室 300 平地毯清洗，必须周日晚上做完，能派几个人，噪音会不会影响楼上？", expected: { itemKeywords: ["地毯清洗"], quantityKeywords: ["300"], addressOrTimeKeywords: ["周日晚上"], missingKeywords: ["地址", "联系方式"], riskKeywords: ["排期", "噪音"], status: "待补充" } },

  { id: "edge-trade-01", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-低 MOQ 私标", message: "We want 120 private label pet bowls, logo on box, but your MOQ says 1000. Can you do trial order to Poland?", expected: { itemKeywords: ["pet bowls"], quantityKeywords: ["120", "1000"], addressOrTimeKeywords: ["Poland"], missingKeywords: ["trade terms"], riskKeywords: ["MOQ", "private label"], status: "待报价" } },
  { id: "edge-trade-02", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-样品费抵扣", message: "Can sample fee and DHL cost be refunded after bulk order? Need 3 samples of silicone bibs to Chile.", expected: { itemKeywords: ["silicone bibs"], quantityKeywords: ["3"], addressOrTimeKeywords: ["Chile"], missingKeywords: ["bulk quantity", "trade terms"], riskKeywords: ["sample fee", "freight"], status: "待补充" } },
  { id: "edge-trade-03", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-认证文件", message: "For EU market, do your baby toys have EN71 and CE reports? Quote 2,000 pcs with test documents.", expected: { itemKeywords: ["baby toys"], quantityKeywords: ["2000"], addressOrTimeKeywords: ["EU"], missingKeywords: ["trade terms", "destination port"], riskKeywords: ["certification", "test"], status: "待报价" } },
  { id: "edge-trade-04", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-付款账期", message: "Our company pays 60 days after delivery. Can you accept OA for first order of 5,000 notebooks?", expected: { itemKeywords: ["notebooks"], quantityKeywords: ["5000"], addressOrTimeKeywords: [], missingKeywords: ["destination", "trade terms"], riskKeywords: ["payment terms", "credit"], status: "待补充" } },
  { id: "edge-trade-05", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-验厂审计", message: "Before placing 20,000 lunch bags, can we arrange BSCI audit and inline inspection? Ship to Mexico.", expected: { itemKeywords: ["lunch bags"], quantityKeywords: ["20000"], addressOrTimeKeywords: ["Mexico"], missingKeywords: ["trade terms", "specification"], riskKeywords: ["audit", "inspection"], status: "待报价" } },
  { id: "edge-trade-06", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-DDP 含税", message: "Quote DDP door to door to UK for 800 electric lunch boxes. Does price include VAT and customs?", expected: { itemKeywords: ["electric lunch boxes"], quantityKeywords: ["800"], addressOrTimeKeywords: ["UK"], missingKeywords: ["specification", "lead time"], riskKeywords: ["DDP", "VAT", "customs"], status: "待报价" } },
  { id: "edge-trade-07", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-急单空运", message: "Need 1,200 promotional umbrellas in Dubai within 12 days. Can you ship by air and split cartons?", expected: { itemKeywords: ["promotional umbrellas"], quantityKeywords: ["1200"], addressOrTimeKeywords: ["Dubai", "12 days"], missingKeywords: ["trade terms", "specification"], riskKeywords: ["rush", "air freight"], status: "待报价" } },
  { id: "edge-trade-08", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-侵权图案", message: "Can you print Disney characters on 3,000 kids bottles if we send artwork? FOB Ningbo.", expected: { itemKeywords: ["kids bottles"], quantityKeywords: ["3000"], addressOrTimeKeywords: ["FOB Ningbo"], missingKeywords: ["destination", "license"], riskKeywords: ["IP", "artwork"], status: "待补充" } },
  { id: "edge-trade-09", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-尾款风险", message: "We pay 10% deposit and 90% after goods arrive in warehouse. Order 10,000 storage boxes to Peru.", expected: { itemKeywords: ["storage boxes"], quantityKeywords: ["10000"], addressOrTimeKeywords: ["Peru"], missingKeywords: ["trade terms", "specification"], riskKeywords: ["payment", "deposit"], status: "待报价" } },
  { id: "edge-trade-10", businessType: "trade", sampleGroup: "刁钻", title: "外贸刁钻-质检不合格", message: "Last container had 4% defective zippers. For next 8,000 backpacks, what compensation and QC plan?", expected: { itemKeywords: ["backpacks", "zippers"], quantityKeywords: ["8000", "4"], addressOrTimeKeywords: [], missingKeywords: ["destination", "trade terms"], riskKeywords: ["defective", "QC"], status: "售后中" } },
];

function normalize(value: unknown) {
  const safe = typeof value === "string" ? value : String(value ?? "");
  return safe.toLowerCase().replace(/\s+/g, "");
}

function includesAny(text: string, keywords: string[]) {
  if (keywords.length === 0) return true;
  const normalizedText = normalize(text);
  return keywords.some((keyword) => getKeywordVariants(keyword).some((variant) => normalizedText.includes(normalize(variant))));
}

function includesAll(text: string, keywords: string[]) {
  if (keywords.length === 0) return true;
  const normalizedText = normalize(text);
  return keywords.every((keyword) => getKeywordVariants(keyword).some((variant) => normalizedText.includes(normalize(variant))));
}

function getKeywordVariants(keyword: string) {
  const variants: Record<string, string[]> = {
    MOQ: ["MOQ", "起订量", "最小起订"],
    "private label": ["private label", "私标", "贴牌"],
    "sample fee": ["sample fee", "样品费"],
    freight: ["freight", "运费", "快递费"],
    certification: ["certification", "认证", "证书"],
    test: ["test", "检测", "测试"],
    "payment terms": ["payment terms", "付款", "账期"],
    credit: ["credit", "账期", "授信"],
    audit: ["audit", "验厂", "审计"],
    inspection: ["inspection", "质检", "验货"],
    DDP: ["DDP", "门到门"],
    VAT: ["VAT", "增值税", "税"],
    customs: ["customs", "清关", "关税"],
    rush: ["rush", "急单", "加急"],
    "air freight": ["air freight", "空运"],
    IP: ["IP", "版权", "侵权", "授权"],
    artwork: ["artwork", "图案", "设计稿"],
    payment: ["payment", "付款"],
    deposit: ["deposit", "定金", "订金"],
    defective: ["defective", "不良", "质量问题", "瑕疵"],
    QC: ["QC", "质检", "质量控制"],
    destination: ["destination", "目的地", "目的港"],
    "trade terms": ["trade terms", "贸易条款", "FOB", "CIF", "DDP"],
    specification: ["specification", "规格", "参数"],
  };
  return variants[keyword] || [keyword];
}

function getResultText(result: AnalyzeApiResponse) {
  return [
    result.summary,
    result.customer_intent,
    result.order_status,
    result.items?.map((item) => `${item.name} ${item.quantity} ${item.unit} ${item.note}`).join(" "),
    result.customer_info?.address,
    result.customer_info?.preferred_time,
    result.missing_info?.join(" "),
    result.risk_flags?.join(" "),
    result.next_action?.join(" "),
    result.reply,
  ].join(" ");
}

function isSendableReply(reply: string, missingKeywords: string[]) {
  const text = normalize(reply);
  if (!text) return false;
  if (["一定有货", "一定送达", "最低价", "guarantee delivery", "must arrive"].some((word) => text.includes(normalize(word)))) return false;
  if (missingKeywords.length > 0 && !includesAny(reply, ["补充", "确认", "请提供", "share", "confirm", "provide"])) return false;
  return true;
}

export function scoreEvaluationSample(sample: EvaluationSample, result: AnalyzeApiResponse): EvaluationScore {
  const text = getResultText(result);
  const metrics: Record<EvaluationMetric, boolean> = {
    "商品/服务识别": includesAll(text, sample.expected.itemKeywords),
    "数量识别": includesAll(text, sample.expected.quantityKeywords),
    "地址/时间识别": includesAll(text, sample.expected.addressOrTimeKeywords) || Boolean(result.customer_info?.address || result.customer_info?.preferred_time),
    "缺失信息完整": includesAll(result.missing_info?.join(" ") || "", sample.expected.missingKeywords),
    "风险点合理": includesAny(result.risk_flags?.join(" ") || "", sample.expected.riskKeywords),
    "回复可直接发": isSendableReply(result.reply, sample.expected.missingKeywords),
    "订单状态正确": normalize(result.order_status || "").includes(normalize(sample.expected.status)),
  };
  const notes = evaluationMetrics.filter((metric) => !metrics[metric]);
  return {
    sampleId: sample.id,
    total: evaluationMetrics.filter((metric) => metrics[metric]).length,
    metrics,
    notes,
  };
}
