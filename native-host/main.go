package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ─── 消息协议 ───────────────────────────────────────────────────

type Request struct {
	Command string `json:"command"`
	Target  string `json:"target"`
	Count   int    `json:"count,omitempty"`
	MaxHops int    `json:"maxHops,omitempty"`
}

type Response struct {
	Success bool        `json:"success"`
	Command string      `json:"command,omitempty"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
	Version string      `json:"version,omitempty"`
	Source  string      `json:"source,omitempty"`
}

type PingResult struct {
	Target  string    `json:"target"`
	Stats   PingStats `json:"stats"`
	Timings []float64 `json:"timings"`
	Raw     string    `json:"rawOutput"`
}

type PingStats struct {
	Min        float64 `json:"min"`
	Avg        float64 `json:"avg"`
	Max        float64 `json:"max"`
	PacketLoss float64 `json:"packetLoss"`
	Sent       int     `json:"sent"`
	Received   int     `json:"received"`
}

type MtrResult struct {
	Target string    `json:"target"`
	Hops   []HopInfo `json:"hops"`
	Raw    string    `json:"rawOutput"`
}

type HopInfo struct {
	Hop       int     `json:"hop"`
	Host      string  `json:"host"`
	Loss      float64 `json:"loss"`
	Sent      int     `json:"sent"`
	Received  int     `json:"received"`
	RttMin    float64 `json:"rttMin"`
	RttAvg    float64 `json:"rttAvg"`
	RttMax    float64 `json:"rttMax"`
	StDev     float64 `json:"stDev"`
	IsTimeout bool    `json:"isTimeout"`
}

const VERSION = "1.1.0"

// ─── Native Messaging I/O ───────────────────────────────────

func readMessage() ([]byte, error) {
	var length uint32
	if err := binary.Read(os.Stdin, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	if length > 1024*1024 {
		return nil, fmt.Errorf("message too large: %d", length)
	}
	msg := make([]byte, length)
	_, err := io.ReadFull(os.Stdin, msg)
	return msg, err
}

func writeMessage(msg []byte) {
	length := uint32(len(msg))
	binary.Write(os.Stdout, binary.LittleEndian, length)
	os.Stdout.Write(msg)
}

func reply(resp Response) {
	data, _ := json.Marshal(resp)
	writeMessage(data)
}

// ─── Ping（系统 ping 命令，所有系统自带）────────────────────

func executePing(target string, count int) PingResult {
	if count <= 0 {
		count = 10
	}
	resolved := target
	if ips, err := net.LookupHost(target); err == nil && len(ips) > 0 {
		resolved = ips[0]
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Windows ping 默认间隔 1 秒，-n 指定次数
		cmd = exec.Command("ping", "-n", strconv.Itoa(count), target)
	} else {
		// macOS/Linux: -c 次数, -i 1 间隔1秒
		cmd = exec.Command("ping", "-c", strconv.Itoa(count), "-i", "1", target)
	}
	out, err := cmd.CombinedOutput()
	raw := string(out)
	r := PingResult{Target: resolved, Raw: raw}
	if err != nil && raw == "" {
		r.Stats = PingStats{PacketLoss: 100, Sent: count}
		return r
	}
	r.Stats = parsePingOutput(raw, count)
	r.Timings = parsePingTimings(raw)
	return r
}

func parsePingOutput(output string, count int) PingStats {
	s := PingStats{Sent: count}
	if runtime.GOOS == "windows" {
		if m := regexp.MustCompile(`Sent = (\d+), Received = (\d+)`).FindStringSubmatch(output); len(m) >= 3 {
			s.Sent, _ = strconv.Atoi(m[1])
			s.Received, _ = strconv.Atoi(m[2])
		}
		if m := regexp.MustCompile(`Minimum = (\d+)ms, Maximum = (\d+)ms, Average = (\d+)ms`).FindStringSubmatch(output); len(m) >= 4 {
			s.Min, _ = strconv.ParseFloat(m[1], 64)
			s.Max, _ = strconv.ParseFloat(m[2], 64)
			s.Avg, _ = strconv.ParseFloat(m[3], 64)
		}
	} else {
		if m := regexp.MustCompile(`(\d+) packets? transmitted, (\d+) (?:packets? )?received`).FindStringSubmatch(output); len(m) >= 3 {
			s.Sent, _ = strconv.Atoi(m[1])
			s.Received, _ = strconv.Atoi(m[2])
		}
		if m := regexp.MustCompile(`(?:rtt|round-trip) min/avg/max/(?:mdev|stddev) = ([\d.]+)/([\d.]+)/([\d.]+)`).FindStringSubmatch(output); len(m) >= 4 {
			s.Min, _ = strconv.ParseFloat(m[1], 64)
			s.Avg, _ = strconv.ParseFloat(m[2], 64)
			s.Max, _ = strconv.ParseFloat(m[3], 64)
		}
	}
	if s.Sent > 0 {
		s.PacketLoss = float64(s.Sent-s.Received) / float64(s.Sent) * 100
	}
	return s
}

func parsePingTimings(output string) []float64 {
	var t []float64
	var re *regexp.Regexp
	if runtime.GOOS == "windows" {
		re = regexp.MustCompile(`time[=<](\d+)ms`)
	} else {
		re = regexp.MustCompile(`time=([\d.]+) ?ms`)
	}
	for _, m := range re.FindAllStringSubmatch(output, -1) {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			t = append(t, v)
		}
	}
	return t
}

// ─── Traceroute（调用系统命令，macOS 自带 traceroute，Windows 自带 tracert）──

func executeMtr(target string, maxHops int) MtrResult {
	if maxHops <= 0 {
		maxHops = 30
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("tracert", "-d", "-w", "2000", "-h", strconv.Itoa(maxHops), target)
	} else {
		// macOS/Linux: -n 不解析DNS, -w 2 每探测等2秒, -q 1 每跳只发1个探测包（加快速度）
		cmd = exec.Command("traceroute", "-n", "-m", strconv.Itoa(maxHops), "-w", "2", "-q", "1", target)
	}

	done := make(chan struct{})
	var output []byte
	var cmdErr error
	go func() {
		output, cmdErr = cmd.CombinedOutput()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(90 * time.Second):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return MtrResult{Target: target, Raw: "traceroute timed out"}
	}

	raw := string(output)
	result := MtrResult{Target: target, Raw: raw}

	if cmdErr != nil && raw == "" {
		result.Raw = "traceroute failed: " + cmdErr.Error()
		return result
	}

	result.Hops = parseTracerouteOutput(raw)
	return result
}

func parseTracerouteOutput(output string) []HopInfo {
	var hops []HopInfo
	lines := strings.Split(output, "\n")

	// 匹配跳数行：以数字开头
	hopRe := regexp.MustCompile(`^\s*(\d+)\s+(.+)`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		m := hopRe.FindStringSubmatch(line)
		if len(m) < 3 {
			continue
		}

		hopNum, err := strconv.Atoi(m[1])
		if err != nil || hopNum <= 0 {
			continue
		}

		rest := m[2]

		// 全超时行
		if regexp.MustCompile(`^\*`).MatchString(rest) && !regexp.MustCompile(`\d+\.\d+\.\d+\.\d+`).MatchString(rest) {
			hops = append(hops, HopInfo{
				Hop: hopNum, Host: "* * *", Loss: 100,
				Sent: 1, Received: 0, IsTimeout: true,
			})
			continue
		}

		// 提取所有 IP 地址（取第一个）
		ipMatch := regexp.MustCompile(`(\d+\.\d+\.\d+\.\d+)`).FindString(rest)

		// 提取所有 RTT 值
		var rtts []float64
		for _, rm := range regexp.MustCompile(`([\d.]+)\s*ms`).FindAllStringSubmatch(rest, -1) {
			if v, err := strconv.ParseFloat(rm[1], 64); err == nil {
				rtts = append(rtts, v)
			}
		}

		// 计算超时探测数（* 的数量）
		timeouts := strings.Count(rest, "*")

		host := ipMatch
		if host == "" {
			host = "* * *"
		} else {
			// 尝试反向 DNS
			if names, err := net.LookupAddr(host); err == nil && len(names) > 0 {
				host = strings.TrimSuffix(names[0], ".") + " (" + ipMatch + ")"
			}
		}

		sent := len(rtts) + timeouts
		if sent == 0 {
			sent = 1
		}

		var rttMin, rttAvg, rttMax, stDev float64
		if len(rtts) > 0 {
			rttMin, rttMax = rtts[0], rtts[0]
			sum := 0.0
			for _, r := range rtts {
				sum += r
				if r < rttMin {
					rttMin = r
				}
				if r > rttMax {
					rttMax = r
				}
			}
			rttAvg = sum / float64(len(rtts))
			if len(rtts) > 1 {
				v := 0.0
				for _, r := range rtts {
					v += (r - rttAvg) * (r - rttAvg)
				}
				stDev = math.Sqrt(v / float64(len(rtts)))
			}
		}

		loss := 0.0
		if sent > 0 {
			loss = float64(timeouts) / float64(sent) * 100
		}

		hops = append(hops, HopInfo{
			Hop:       hopNum,
			Host:      host,
			Loss:      math.Round(loss*100) / 100,
			Sent:      sent,
			Received:  len(rtts),
			RttMin:    math.Round(rttMin*100) / 100,
			RttAvg:    math.Round(rttAvg*100) / 100,
			RttMax:    math.Round(rttMax*100) / 100,
			StDev:     math.Round(stDev*100) / 100,
			IsTimeout: len(rtts) == 0,
		})
	}

	return hops
}

// ─── 卸载 ───────────────────────────────────────────────────

func executeUninstall() string {
	var msgs []string
	if runtime.GOOS == "windows" {
		exec.Command("reg", "delete", `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.network.analyzer`, "/f").Run()
		exec.Command("reg", "delete", `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.network.analyzer`, "/f").Run()
		msgs = append(msgs, "已移除浏览器注册")
		installDir := os.Getenv("LOCALAPPDATA") + "\\Network-Analyzer"
		os.Remove(installDir + "\\com.network.analyzer.json")
		msgs = append(msgs, "请手动删除 "+installDir)
	} else {
		home, _ := os.UserHomeDir()
		os.Remove(home + "/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.network.analyzer.json")
		os.Remove(home + "/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.network.analyzer.json")
		msgs = append(msgs, "已移除浏览器注册")
		msgs = append(msgs, "请手动删除 /usr/local/lib/network-analyzer/ 目录")
	}
	return strings.Join(msgs, "\n")
}

// ─── 主循环 ─────────────────────────────────────────────────

func main() {
	for {
		msgBytes, err := readMessage()
		if err != nil {
			if err == io.EOF {
				os.Exit(0)
			}
			os.Exit(1)
		}
		var req Request
		if err := json.Unmarshal(msgBytes, &req); err != nil {
			reply(Response{Success: false, Error: "invalid JSON: " + err.Error()})
			continue
		}
		switch req.Command {
		case "ping_check":
			reply(Response{Success: true, Command: "ping_check", Version: VERSION, Source: "local"})
		case "ping":
			if req.Target == "" {
				reply(Response{Success: false, Error: "target is required"})
				continue
			}
			reply(Response{Success: true, Command: "ping", Data: executePing(req.Target, req.Count), Source: "local"})
		case "mtr":
			if req.Target == "" {
				reply(Response{Success: false, Error: "target is required"})
				continue
			}
			reply(Response{Success: true, Command: "mtr", Data: executeMtr(req.Target, req.MaxHops), Source: "local"})
		case "uninstall":
			reply(Response{Success: true, Command: "uninstall", Data: executeUninstall(), Source: "local"})
		default:
			reply(Response{Success: false, Error: "unknown command: " + req.Command})
		}
	}
}
