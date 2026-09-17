# 04 派发裁决 —— PM 对 S3 拉通结果的决断

> run id：<run_id>
> 阶段：S4（执行者 at-pm）
> 前置：`01-prd.md`、`03-arch.md`

## 1. 本趟班底

<按需组队（决策 D2）。列出这趟真正要叫的角色，以及**每个没被叫的角色为什么不叫**——
后者写进 state.json 的 never_invoked。防的是 aws-samples 的真实失效：安全架构师角色在
整个多日项目中从未被调用且无人发现。>

## 2. 分工

| 角色 | 要做什么 | 完成定义 | 产物 |
|---|---|---|---|

## 3. 裁决与理由

<S3 拉通里出现的分歧，PM 在这里定。§5.2 的范围内 PM 自决：技术选型、班底裁剪、
驳回路由、代码风格与目录命名、上限内的单角色重试。>

## 4. 没有自决、已升级给用户的

<§5.1 的五类。每条对应 state.json 的 escalations[] 里一条，kind 用同一个取值：
sensitive / contract-conflict / tradeoff / contract-hole / budget-exhausted。>
