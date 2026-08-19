---
title: AfterBlacout项目技术讲解
date: 2026-08-19 11:44:50
categories: UE
tags: [UE,]
---

# After Blackout：UE5 合作丧尸射击 Demo

> 一个以 gameplay 程序开发为重点的 UE5.8 个人项目。本文记录项目的整体架构、关键系统，以及开发过程中最值得复盘的网络同步、丧尸生命周期和性能问题。

---

## 一、项目介绍

### 1.1 项目是什么

After Blackout 是一款基于 Unreal Engine 5.8 开发的合作 PvE 丧尸生存射击 Demo。玩家与队友进入废弃街区，寻找补给、启动发电机、抵抗尸潮，并在完成目标后前往撤离区域。

项目采用第三人称视角，玩法包含：

- 角色移动、瞄准、射击、换弹和受击。
- 丧尸巡逻、发现玩家、追击、攻击、受击和死亡。
- 弹药箱、血包、发电机和门等交互物。
- 准备大厅、玩家选择、游戏开始、胜利、失败和重启流程。
- Listen Server 合作联机，以及服务器权威的共享状态管理。

### 1.2 项目技术栈

Unreal Engine 5.8 · C++ · Blueprint · Enhanced Input · UMG · Behavior Tree · Blackboard · NavMesh · RPC / Replication · DataAsset · Gameplay Tags

### 1.3 游戏流程

```text
开始界面
    → 创建/加入房间
    → 准备大厅与角色/武器选择
    → 主机确认玩家状态
    → 进入废弃街区
    → 探索、补给和交互
    → 启动发电机并触发刷怪事件
    → 射击并击退尸群
    → 到达撤离区域
    → 胜利 / 全员淘汰 / 重启
```

---

## 二、系统架构

{% mermaid %}
flowchart TD
    UI[Widget / HUD] --> PC[ZombiePlayerController]
    PC -->|Server RPC| GM[ZombieGameMode]
    GM --> GS[ZombieGameState]
    GM --> PS[ZombiePlayerState]
    PC --> Character[BP_PlayerCharacter]
    Character --> Rifle[BP_Rifle]
    Rifle -->|Server damage| Zombie[BP_ZombieCharacter]
    GM --> Manager[AZombieManager]
    Generator[GeneratorInteractable] -->|Spawn Event Tag| Manager
    Manager -->|DataAsset| SpawnData[Spawn Event / Zombie Data]
    Manager -->|Acquire / Release| Pool[AvailablePool / ActiveZombies]
    Manager --> Zombie
    Zombie --> AI[AIController / Behavior Tree]
    GS --> UI
    PS --> UI
{% endmermaid %}

<script src="/js/mermaid.min.js"></script>
<script>
(function () {
  function renderMermaid() {
    if (!window.mermaid) {
      window.setTimeout(renderMermaid, 250);
      return;
    }

    mermaid.initialize({ theme: 'default' });
    var diagrams = document.querySelectorAll('.mermaid:not([data-processed])');
    if (diagrams.length > 0) {
      mermaid.init(undefined, diagrams);
    }
  }

  renderMermaid();
})();
</script>

### 2.1 从上到下阅读这张图

#### 玩家与 UI

Widget / HUD 不直接修改游戏规则，而是通过 ZombiePlayerController 发起本地操作。Controller 负责把 UI 操作送到服务器边界，再把复制后的状态反馈给 HUD。

#### 游戏流程

- ZombieGameMode：服务器专属，负责开始、胜利、失败、淘汰和重启规则。
- ZombieGameState：保存并复制所有客户端都需要知道的游戏流程状态和大厅摘要。
- ZombiePlayerState：保存并复制单个玩家的准备、淘汰、外观和武器选择。
- ZombiePlayerController：连接本地 UI、玩家输入和服务器请求。

#### 玩家战斗链

ZombiePlayerController 与 BP_PlayerCharacter 连接，角色持有 BP_Rifle，枪械的最终伤害结果作用于 BP_ZombieCharacter。

这条链上的基本原则是：

```text
客户端输入
    → Server RPC
    → 服务器验证
    → 服务器修改权威状态
    → 复制状态或播放表现事件
    → HUD、动画、音效和特效更新
```

#### 丧尸生成链

发电机或其他关卡交互物通过 Spawn Event Tag 请求 AZombieManager 触发刷怪。管理器读取 Spawn Event / Zombie Data，选择生成点和丧尸配置，再决定走普通 Spawn/Destroy 路径还是 Object Pool 的 Acquire/Release 路径。

AZombieManager 不负责具体丧尸的攻击表现，而是通过 Blueprint Contract 调用丧尸蓝图中的 ZombieData、InitializeZombie、ActivateFromPool、DeactivateToPool 等成员。

### 2.2 架构图中最重要的三条边界

1. **规则边界**：GameMode 决定规则，GameState/PlayerState 复制结果。
2. **战斗边界**：角色和枪械发起请求，服务器决定弹药、命中和伤害。
3. **生命周期边界**：ZombieManager 决定丧尸何时生成、激活、死亡、回收或销毁，丧尸蓝图负责自身的属性、AI 和表现。

---

## 三、关键系统

### 3.1 角色系统：BP_PlayerCharacter

角色是玩家输入、移动、生命状态、武器和交互的组合入口。

#### 主要职责

- 使用 Enhanced Input 处理移动、视角、跳跃、瞄准、开火、换弹和交互。
- 管理当前生命、受伤、死亡和玩家状态。
- 保存当前武器引用，并把输入转换成武器请求。
- 持有交互扫描组件，把 E 键操作送入统一交互流程。
- 为本地镜头、动画、HUD 和音效提供表现层接口。

角色本身不应该直接在客户端决定伤害或交互结果。它只表达“玩家想做什么”，最终结果由服务器规则和对应系统处理。

![After Blackout Fire本地链路](/img/AfterBlackout/Fire.png)

玩家本地输入只负责发起开火请求；服务器验证武器归属、射速、弹药和命中结果，并修改权威状态，包括当前弹匣数量、丧尸 Health、IsDead 以及 ZombieManager 的存活数量。客户端收到复制结果后，再更新 HUD、受击/死亡动画和其他表现。

### 3.2 枪械系统：BP_Rifle

枪械系统负责玩家的射击闭环，而不是只负责播放枪口火焰。

#### 主要职责

- 开火间隔、持续开火和射击状态。
- 当前弹匣、备弹和换弹流程。
- 从摄像机或枪口方向发起 Line Trace。
- 根据命中结果请求 Apply Point Damage。
- 处理散布、后坐力、枪口火焰、枪声、弹道和动画。
- 通过配置数据读取伤害、射速、弹容量、散布和换弹时间。

#### 开火路径

```text
本地 IA_Fire
    → ServerFire 
    → 服务器检查武器归属、射速和弹药
    → 服务器 Line Trace
    → 服务器 ApplyPointDamage
    → 丧尸生命值和死亡状态改变
    → 各客户端播放对应表现
```
#### 核心命中逻辑-射线判定

从玩家摄像机中心发出辅助射线，用于找到准星所指的命中点，然后从枪口发射实际命中射线，定位实际命中点。

![After Blackout Fire射线判定](/img/AfterBlackout/FireTrace.png)

![After Blackout Fire射线判定演示图](/img/AfterBlackout/ShowFireTrace.png)

### 3.3 丧尸系统：BP_ZombieCharacter

丧尸角色把属性、AI、受击、死亡和对象池生命周期连接在一起。

#### 主要职责

- 从 Zombie Data 读取生命、移动速度、攻击伤害、攻击间隔和攻击范围。
- 与 BP_ZombieAIController、Behavior Tree、Blackboard 和 NavMesh 配合。
- 处理目标、追击、攻击、Point Damage、受击硬直和死亡。
- 响应 InitializeZombie、ActivateFromPool、DeactivateToPool 等管理器接口。
- 在死亡时通知 AZombieManager，由管理器决定延迟回收或销毁。

#### AI 逻辑

```text
感知系统 / 噪音事件
    → 更新 Blackboard：TargetActor / NoiseLocation
    → Behavior Tree Selector 按优先级选择分支

    攻击分支：TargetActor 有效且进入攻击范围
        → BTT_IsInAttackRange
        → BTT_ZombieAttack
        → Wait

    玩家追击分支：TargetActor 有效但尚未进入攻击范围
        → Move To TargetActor

    噪音追击分支：NoiseLocation 有效且没有更高优先级目标
        → Move To NoiseLocation
        → BTT_ClearNoiseLocation

    巡逻分支：没有玩家目标和噪音目标时的默认行为
        → Select Random Patrol Location
        → Move To Patrol Location
        → Wait
```

![After Blackout 丧尸行为树](/img/AfterBlackout/AfterBlackout_BehaviorTree.png)

*图 2：BP_Zombie 的 Behavior Tree。Selector 下包含攻击、玩家追击、噪音追击和巡逻四个分支；分支条件通过 Blackboard Key 和 Decorator 控制，攻击与追击分支可以在目标状态变化时中断低优先级行为。*

这棵行为树的优先级可以概括为“先处理已经进入攻击范围的玩家，再追击可见玩家，其次响应噪音位置，最后进行随机巡逻”。因此丧尸不是固定执行一条“发现玩家后一直追击”的线性流程，而是根据 Blackboard 中的目标状态在多个行为之间切换。

普通、快速和坦克型丧尸复用同一套基础角色和 AI 逻辑，通过不同的 Zombie Data 调整属性，而不是复制三套完全独立的蓝图。

### 3.4 丧尸管理器：AZombieManager

AZombieManager 不是一个简单的“刷怪接口集合”，而是把刷怪事件、生成点选择、对象获取、死亡统计和生命周期清理串成一条 C++ 执行链。关卡蓝图只负责触发事件，具体的生成和回收由管理器统一完成。


#### 3.4.1 从 Spawn Event 到定时生成

关卡中的发电机或其他玩法对象只需要传入 Gameplay Tag。TriggerSpawnEvent 首先拒绝客户端调用，再查找对应的 Spawn Event DataAsset，检查事件是否已经运行或是否只能触发一次，最后创建 Spawn Timer。

```text
TriggerSpawnEvent(EventTag)
    → 客户端调用直接拒绝
    → 查找 Spawn Event DataAsset
    → 检查重复触发和 TriggerOnce
    → 初始化 SpawnedCounts / EventAliveCounts
    → 绑定 SpawnNextZombie(EventTag)
    → 按 SpawnInterval 启动 Timer
```

![TriggerSpawnEvent 关键 C++ 代码](/img/AfterBlackout/AfterBlackout_ZombieManager_TriggerSpawnEvent.png)

*图 3：TriggerSpawnEvent 的关键实现。。*

代码中的关键判断可以概括为：

```cpp
if (IsNetMode(NM_Client))
{
    return false;
}

const UZombieSpawnEventData* SpawnEvent = FindSpawnEvent(EventTag);
if (!SpawnEvent || IsSpawnEventRunning(EventTag))
{
    return false;
}

SpawnDelegate.BindUObject(this, &AZombieManager::SpawnNextZombie, EventTag);
GetWorldTimerManager().SetTimer(
    TimerHandle, SpawnDelegate, SpawnInterval, true);
```

这里的设计价值在于：刷怪事件只由服务器启动，生成过程被拆成多个 Timer Tick，不会因为一次事件配置了很多丧尸，就在同一帧集中创建全部 Actor。

#### 3.4.2 SpawnNextZombie：先检查条件，再创建对象

每次 Timer 触发 SpawnNextZombie 时，管理器不会直接 SpawnActor，而是依次检查：

1. 事件是否存在、生成数量是否达到上限。
2. 当前总存活数量是否达到 MaxAliveZombies。
3. 当前事件存活数量是否达到 MaxAliveCount。
4. 是否能选到符合标签的生成点和 Zombie Data。
5. 生成位置是否在 NavMesh 上、距离玩家足够远且没有碰撞。

只有全部条件通过后，才会进入 AcquireZombie。生成点失败时不增加已生成数量，下一次 Timer 继续尝试，这样配置数量和实际 Actor 数量不会失配。

![SpawnNextZombie 关键 C++ 代码](/img/AfterBlackout/AfterBlackout_ZombieManager_SpawnNextZombie.png)

*图 4：SpawnNextZombie 的条件检查、生成点筛选、Zombie Data 选择和 ActiveZombies 注册。*

```text
SpawnNextZombie
    → 检查 SpawnCount / MaxAliveZombies / MaxAliveCount
    → ChooseSpawnPoint
    → ChooseZombieDataClass
    → FindFreeSpawnTransform
    → AcquireZombie
    → ActiveZombies.Add
    → BindZombieDeath
    → 广播 OnZombieSpawned
```

生成位置的选择也不是固定使用 Spawn Point 的原始 Transform。FindFreeSpawnTransform 会尝试投影到 NavMesh，检查与玩家的最小距离，并使用丧尸胶囊体进行阻挡检测；失败时把这次生成推迟到下一次 Timer。

#### 3.4.3 AcquireZombie：对象池与普通生成的分支

AcquireZombie 是两种生命周期路径的汇合点：

```text
AcquireZombie
    → bUseObjectPool？
        → AvailablePool 有对象：取出并激活
        → 池耗尽且允许扩容：创建新的池对象
        → 不允许扩容：本次生成失败
    → 对象池关闭：SpawnActorDeferred
    → 设置 ZombieData
    → 设置复制和移动复制
    → InitializeZombie
```

![AcquireZombie 关键 C++ 代码](/img/AfterBlackout/AfterBlackout_ZombieManager_AcquireZombie.png)

*图 5：AcquireZombie 复用空闲对象、扩容和普通 Deferred Spawn 的分支。*

对象池复用时，当前代码的核心顺序是：

```
唤醒网络
    → 标记为“正在初始化”
    → 设置新位置
    → 激活 AI
    → 重置丧尸数据
    → 恢复显示、碰撞和 Tick
    → 标记为“正式激活”
    → 强制同步客户端
```

普通生成则使用 SpawnActorDeferred，先设置：

- SetReplicates(true)
- SetReplicateMovement(true)
- ZombieData
- PoolActive 状态

完成 FinishSpawning 后，再调用无参数的 InitializeZombie。这样 Blueprint 负责具体丧尸的初始化和表现，C++ 负责生成时机、网络契约和生命周期管理。

#### 3.4.4 HandleZombieDied 到 ReleaseZombie

丧尸死亡后不立即由丧尸蓝图自行 Destroy，而是通过死亡委托通知 Manager：

```text
BP_ZombieCharacter.OnZombieDied
    → HandleZombieDied
    → 从 ActiveZombies 移除
    → 更新对应 Spawn Event 的存活数量
    → 解绑死亡委托
    → 按 RecycleDelay 延迟清理
    → ReleaseZombie
        → 对象池开启：DeactivateToPool → AvailablePool
        → 对象池关闭：Destroy
```

![ReleaseZombie 关键 C++ 代码](/img/AfterBlackout/AfterBlackout_ZombieManager_ReleaseZombie.png)

*图 6：HandleZombieDied 和 ReleaseZombie 的死亡统计、延迟清理、对象池回收与销毁分支。*

这里的关键点是两条 A/B 路径共用同一个死亡清理时机。对象池关闭时走 Destroy，开启时走 DeactivateToPool；这样性能对比中的尸体表现和 RecycleDelay 保持一致，变化因素主要集中在 Actor 是否被重复创建和销毁。

#### 3.4.5 这个模块的 C++/Blueprint 边界

- C++：服务器权限、刷怪事件、Timer、数量统计、生成点筛选、对象池和死亡回收。
- DataAsset：Spawn Event、Zombie Data、生成数量、间隔、权重和类型配置。
- Blueprint：ZombieData 的具体应用、AI、入场动画、受击和死亡表现。
- 关卡蓝图：摆放交互物和生成点，调用 Spawn Event Tag。

AZombieManager 的价值是把关卡事件、数据配置、对象生命周期和网络规则集中到一个可复用的 C++ 模块中。


### 3.5 交互物：发电机、补给箱和门

项目把“扫描目标”和“执行交互”从具体交互物中抽离出来，使用 UInteractionScannerComponent 统一处理。

#### 统一交互流程

```text
扫描附近目标
    → 更新 CurrentInteractable
    → 高亮目标并显示提示
    → 玩家按 E / TryInteract
    → ServerTryInteract(Target)
    → 服务器检查距离、目标状态和合法性
    → ExecuteInteraction
    → ClientInteractionResult
    → HUD 更新提示、资源或目标状态
```

AInteractableBase 提供共同的交互约定，发电机、弹药箱、血包和门只实现自身的结果。这样可以避免每个交互物重复实现“找玩家、找距离、显示提示、判断合法性”的逻辑。

发电机还可以在服务器确认交互成功后，通过 Gameplay Tag 调用 AZombieManager::TriggerSpawnEvent，把“交互目标完成”和“尸潮开始”连接起来。

---

## 四、技术难点


### 4.1 网络同步：客户端请求，服务器裁决，客户端表现

#### 问题

单机逻辑可以在本地直接开火、扣血、减少弹药和打开门；但多人游戏中，如果每个客户端都自行修改这些状态，就会出现：

- 两个客户端看到的弹药数量不同。
- 不同客户端对同一只丧尸得到不同的命中和死亡结果。
- 每个客户端独立刷怪，导致尸群数量倍增。
- 玩家准备、淘汰、胜利和失败状态无法统一。

#### 设计

项目采用服务器权威 + 状态同步，而不是纯帧同步：

```text
客户端输入
    → 本地即时反馈
    → Owned Actor 上的 Server RPC
    → 服务器校验请求
    → 服务器修改权威状态
    → Replicated / RepNotify / Client RPC
    → 客户端更新 HUD、动画、音效和特效
```

选择状态同步的原因是项目同时包含 CharacterMovement、AI 导航、随机刷怪、对象池、动画和 Chaos/布娃娃。这些系统不适合依赖不同机器逐帧得到完全一致的结果。对于 2-4 人合作 PvE，服务器负责共享结果，客户端负责操作和表现，更符合系统边界。

#### 模块分工

| 模块 | 同步职责 |
|---|---|
| ZombieGameMode | 服务器专属规则，不直接复制给客户端 |
| ZombieGameState | 复制全局游戏阶段、准备汇总和比赛状态 |
| ZombiePlayerState | 复制玩家准备、淘汰、外观和武器选择 |
| ZombiePlayerController | 接收本地 UI 操作，发送 Server RPC |
| BP_PlayerCharacter | 处理玩家输入、移动、生命和枪械请求 |
| BP_Rifle | 服务器验证归属、射速、弹药、射线和伤害 |
| AZombieManager | 服务器刷怪、AI 相关管理、数量和对象池 |

#### 具体开火案例

开火不是“按键后直接 Apply Damage”，而是分成四个阶段：

1. **请求**：本地 IA_Fire 产生开火请求。
2. **校验**：服务器检查武器是否属于该玩家、射速是否满足、是否还有弹药。
3. **裁决**：服务器执行 Line Trace、扣弹药和 Apply Point Damage。
4. **表现**：生命值、死亡状态等持久状态通过复制同步；枪口火焰、枪声、受击动画等表现由本地或服务器事件驱动。

这条链解决了“客户端看起来打中了，但服务器没有认可”的边界问题。

#### 具体 Bug：复制不等于本地引用完成

开发过程中出现过服务器能够使用武器、客户端本地武器引用没有准备好的情况。原因是武器引用初始化和 Authority 专属逻辑混在了一起。

处理时需要把两件事拆开：

- 本地角色必须完成自己的武器引用和 HUD 表现初始化。
- 服务器才负责 Owner、弹药、命中和伤害等权威状态。

同时在开火入口增加 IsValid(RifleRef) 检查，避免空引用把网络问题和本地初始化问题混在一起。

#### 验证方式

[▶ 在线播放：28 届 UE 游戏客户端求职 Demo](https://www.bilibili.com/video/BV19Lbr65EPY)

请观看视频1：17到1：44。

目前双客户端玩家进入、互见、开火伤害、丧尸同步和移动已验证。

### 4.2 大量丧尸生成和销毁造成卡顿

#### 问题

尸潮中如果不断执行：

```text
SpawnActor
    → FinishSpawning
    → BeginPlay / 组件注册 / AI 初始化
    → 战斗
    → DestroyActor
    → GC
```

创建和销毁会把多个成本叠加到同一帧：

- Actor 和组件创建。
- Skeletal Mesh、碰撞和物理状态初始化。
- AIController、Behavior Tree 和 Blackboard 启动。
- 动画实例、导航和 Tick 注册。
- 死亡时的布娃娃和物理切换。
- Destroy 后等待 GC 和资源回收。

当大量丧尸集中出现或同时死亡时，平均 FPS 不一定马上下降，但 Game Thread 和最长帧时间可能出现明显尖峰。

#### 设计：Timer 控制节奏，对象池负责复用

这里的重点不是把所有刷怪检查项堆在一起，而是用两层机制解决“同一帧创建过多 Actor”的问题。

**1. 使用 Timer 把一次刷怪事件拆成多次生成尝试**

触发 Spawn Event 时，`AZombieManager` 只启动一个循环 Timer；每次 Timer Tick 调用一次 `SpawnNextZombie(EventTag)`，而不是在一个函数里连续生成整波丧尸。每次尝试最多取得一只丧尸：

```text
Timer Tick
    → 检查 SpawnCount / MaxAliveZombies / EventAliveCount
    → 检查生成点、NavMesh、玩家距离和碰撞
    → 条件不满足：本次直接返回，下一次 Timer 继续尝试
    → 条件满足：进入 AcquireZombie
```

只有 `AcquireZombie` 成功返回 Actor 后，才会增加 `SpawnedCount`、`EventAliveCount`，并把 Actor 加入 `ActiveZombies`。因此生成点暂时不可用、存活数量达到上限或对象池暂时没有可用对象时，都不会错误增加已生成数量；达到 `SpawnCount` 后才清理 Timer。

**2. 使用 AcquireZombie 统一对象池和普通生成路径**

`AcquireZombie` 是刷怪流程的唯一取对象入口：

```text
AcquireZombie
    → 对象池开启且 AvailablePool 有对象：取出并复用
        → 重置 ZombieData、Transform、AI 和激活表现
    → 对象池开启但池耗尽：按上限决定是否扩容
    → 对象池关闭：SpawnActorDeferred 创建新 Actor
```

复用对象时不会重新经历完整的 `SpawnActor → BeginPlay → Destroy → GC` 生命周期，而是重置位置和数据，调用 `ActivateFromPool`、`InitializeZombie` 以及激活表现函数，再通过 `ForceNetUpdate` 及时同步客户端。这样可以把频繁刷怪造成的 Actor 创建、组件注册和销毁压力，转化为有限数量对象的重复初始化。


#### 性能验证

[▶ 在线播放：28 届 UE 游戏客户端求职 Demo](https://www.bilibili.com/video/BV19Lbr65EPY)

请观看视频1：55到结尾。

纯生命周期测试中，对象池能明显降低重复创建和销毁带来的帧耗时尖峰。
完整逻辑测试中，AI、寻路和动画占据了更多性能开销，因此平均帧率差异较小

### 4.3 对象池复用下的 AI、动画和网络状态时序

#### 问题

对象池把“一次创建、一次销毁”的 Actor，变成“多次激活、战斗、回收、再激活”的 Actor。旧状态如果没有清理，就会出现：

- 丧尸刚出现就开始移动，跳过入场动画。
- 复用后继续追踪上一次的玩家。
- 上一次死亡留下的 Health、IsDead 或 Hit Stun 状态没有重置。
- 布娃娃、碰撞、Mesh 可见性和 Tick 状态残留。
- 客户端仍认为 Actor 处于休眠或非激活状态。
- AI 在 InitializeZombie 之前已经被 Possess 或开始运行。

#### 生命周期分层

我把对象池生命周期分成 Manager、Zombie Blueprint 和 Network Presentation 三层：

| 阶段 | Manager | Zombie Blueprint | 网络/表现 |
|---|---|---|---|
| Prewarm | 创建池对象 | 进入非激活状态 | 隐藏、关闭碰撞和 AI |
| Acquire | 取出 AvailablePool，设置 Transform | ActivateFromPool、InitializeZombie | 唤醒网络状态 |
| Entrance | 等待初始化完成 | 播放起身/入场动画 | 暂停 AI 和移动 |
| Active | 加入 ActiveZombies | 进入正常行为树 | 显示、碰撞、Tick、移动有效 |
| Die | 接收 OnZombieDied | 播放死亡表现 | 同步死亡状态 |
| Release | 延迟后调用 ReleaseZombie | DeactivateToPool、清理状态 | 隐藏、休眠、回到池 |



### 4.4 数据驱动：把配置和运行时状态分开

#### 问题

如果把生命、移动速度、射速、弹容量和刷怪数量全部写进角色蓝图或管理器逻辑，那么每次调数值都要改节点；新增一种丧尸时，也容易复制出一套新的蓝图。

#### 设计

项目把数据分成三层：

```text
DataAsset / Data Class
    → 保存默认属性和资源配置

Actor / Component
    → 保存当前生命、弹药、目标和运行时状态

Gameplay Logic
    → 读取配置并执行移动、开火、攻击、刷怪和回收
```

#### 配置内容

| 数据 | 典型配置 |
|---|---|
| Player Data | 最大生命、行走速度、开火移动速度 |
| Rifle Data | 伤害、射速、弹匣容量、备弹、散布、后坐力、换弹时间 |
| Zombie Data | 角色类、生命、移动速度、攻击伤害、攻击间隔、攻击范围、缩放 |
| Spawn Event Data | 生成点标签、丧尸类型权重、数量、间隔、最大存活数 |

Gameplay Tags 用来标识刷怪事件、生成点类型和目标类别，使关卡蓝图只需要触发一个语义明确的 Tag，而不需要知道管理器内部如何选择生成点和丧尸类型。

例如：

```text
GeneratorInteractable
    → TriggerSpawnEvent(Event.Zombie.GeneratorPowered)
    → ZombieManager 查找 Spawn Event Data
    → 根据标签和权重选择生成点、Zombie Data
    → Spawn 或 Acquire
```

#### C++ 与 Blueprint 的边界

- C++ 管理器负责通用规则、权限、数量和生命周期。
- DataAsset 负责可调参数和资源引用。
- Blueprint 子类负责具体角色、动画、UI 和表现。
- 关卡蓝图负责摆放对象、配置 Tag 和触发玩法事件。

这种分工可以让新增丧尸类型更多地表现为“新增一份配置”，而不是复制完整的 AI 和刷怪逻辑。


---

## 结语

After Blackout 的重点不是单纯做出一个可以开枪的场景，而是把一个合作 PvE 游戏需要的 gameplay 结构拆开并重新连接：

- 角色和枪械负责玩家操作与战斗反馈。
- 丧尸和 AI 负责战斗压力。
- ZombieManager 负责刷怪规则和对象生命周期。
- 交互组件负责统一处理目标扫描和服务端请求。
- GameMode、GameState、PlayerState 和 Controller 负责多人流程边界。
- 对象池和数据驱动则分别解决高频生命周期开销与配置维护问题。

每个系统都遵循同一条开发思路：

```text
明确问题
    → 划分权威与职责
    → 设计可复用接口
    → 接入 Blueprint 和资源
    → 用编译、日志、PIE 或性能工具验证
```
