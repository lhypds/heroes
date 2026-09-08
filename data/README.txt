
1  crawling

入库	66,751 人
own ≥ 200	10,816
own ≥ 500	2,029
own ≥ 1000	829
fork 比自建还多的	4,081

Run crawl.js
It will get all the own >= 100 users in GitHub.
Data write to crawl.db
20260908 get 66751 users.

2  cleaning

Remove all no name, no location, no website, no follower, all empty users.
- 10868 = 55881

Remove all first 10 repo's commit less than 100 user.
(1 repo less than 10 commits)
