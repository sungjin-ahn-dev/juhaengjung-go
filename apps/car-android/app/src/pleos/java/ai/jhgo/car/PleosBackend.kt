package ai.jhgo.car

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

// ---- Pleos Vehicle SDK 2.3.2 (공식 API 레퍼런스 시그니처 — 멀미예보·TripRoom docs/API_MATRIX.md) ----
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.api.model.capability.AreaBounds
import ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig
import ai.pleos.playground.vehicle.constant.area.SeatValue
import ai.pleos.playground.vehicle.constant.area.TurnSignalValue
import ai.pleos.playground.vehicle.listener.BrakePedalStatusListener
import ai.pleos.playground.vehicle.listener.EvBatteryStateOfChargeListener
import ai.pleos.playground.vehicle.listener.SeatOccupancyListener
import ai.pleos.playground.vehicle.listener.SteeringWheelAngleListener
import ai.pleos.playground.vehicle.listener.TurnSignalStateListener

// ---- Pleos NaviHelper SDK 3.0.5 ----
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.NavigationStatus
import ai.pleos.playground.navi.constants.RouteOption
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.TBTInfo
import ai.pleos.playground.navi.data.WaypointChangedInfo
import ai.pleos.playground.navi.data.WaypointInfo
// TODO(G0) 아래 세 클래스는 필드·생성자는 레퍼런스에서 확인했고, 패키지는 다른 data 클래스와 같은 곳으로 적었다.
//          컴파일 오류가 나면 import 줄만 레퍼런스의 패키지로 고치면 된다(docs/API_MATRIX.md).
import ai.pleos.playground.navi.data.TripInfo
import ai.pleos.playground.navi.data.TripRequest
import ai.pleos.playground.navi.data.WaypointArrivedInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener

/**
 * 실제 Pleos Connect SDK로 브리지 메서드를 처리한다. 메서드 목록은 docs/BRIDGE.md.
 *
 * 레퍼런스로 확인한 것만 부른다. 확인하지 못한 기능은 대신할 수 있으면 확인된 API로 대신하고(아래 '대체'), 아니면 거절한다.
 *  - 목적지 설정(requestRoute·requestRouteWithWaypoints): RouteInfo 필드 미확인 → 거절. 목적지는 Pleos 내비에서 정한다.
 *  - 차종(CarInfo): VIN·CRN만 확인, 모델명 없음 → null. 앱이 한 번 고르게 한다.
 *  - 주행거리(Odometer): 시그니처 미확인 → 대체: NaviHelper 현재 위치를 1초마다 누적한 거리.
 *  - 내비 상태 조회: getter 미확인 → onNavigationStatus로 받은 값, 아직 없으면 목적지 유무로 추정.
 *  - 목적지 도착: 전용 콜백 미확인 → 대체: 안내 중(ROUTE_DRIVE)이던 목적지가 300m 안에서 안내가 끝나면 도착.
 *  - 경유지 도착 지점: WaypointArrivedInfo 필드 미확인 → 대체: 도착 콜백을 받은 순간의 현재 위치.
 *  - 주행 중 여부: AAOS CarUxRestrictionsManager. 못 쓰면 대체: 위치 변화로 잰 속도 > 5km/h.
 *  - 트렁크·연료 주행 가능 거리: 미확인 → 이벤트 없음 / null.
 */
class PleosBackend(private val context: Context) : SdkBackend {
    private var emit: (String, Any?) -> Unit = { _, _ -> }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val voice = NativeVoice(context)
    private val ux = DrivingRestriction(context)

    override fun setEmitter(emit: (event: String, payload: Any?) -> Unit) {
        this.emit = emit
    }

    override suspend fun call(method: String, args: JSONObject): Any? = when (method) {
        // ── NaviHelper ──
        "NaviHelper.getNavigationStatus" -> navigationStatus()
        "NaviHelper.getDestinationInfo" -> destination()
        "NaviHelper.getCurrentLocationInfo" -> location()
        "NaviHelper.getWaypointInfo" -> waypoints()
        "NaviHelper.getTBTInfo" -> tbt()
        "NaviHelper.requestTrip" -> requestTrip(args)
        "NaviHelper.addWaypoint" -> addWaypoint(args)
        "NaviHelper.removeWaypoint" -> {
            navi().removeWaypoint(WaypointIndex.valueOf(args.getString("idx")))
            lastWpsAt = 0L
            null
        }
        "NaviHelper.changeRouteOption" -> {
            navi().changeRouteOption(RouteOption.valueOf(args.getString("option")))
            null
        }
        "NaviHelper.cancelRoute" -> {
            navi().cancelRoute()
            null
        }
        "NaviHelper.requestRoute", "NaviHelper.requestRouteWithWaypoints" ->
            throw UnsupportedOperationException("UNVERIFIED_ROUTE_INFO: RouteInfo 필드를 아직 확인하지 못했어요(G0). 목적지는 Pleos 내비에서 정해 주세요")

        // ── Vehicle ──
        "Vehicle.getCarInfo" -> JSONObject().put("manufacturer", JSONObject.NULL).put("model", JSONObject.NULL).put("modelYear", JSONObject.NULL)
        "Vehicle.capabilities" -> capabilities()
        "Vehicle.registerSeatOccupancy" -> registerSeats(args.optJSONArray("area"), args.optString("tag", "row2"))
        "Vehicle.getEvBatteryStateOfCharge" -> soc()
        "Vehicle.registerEvBatteryStateOfCharge" -> registerSoc()
        "Vehicle.getFuelRangeKm" -> null
        "Vehicle.registerTurnSignalState" -> registerTurnSignal()
        "Vehicle.registerSteeringWheelAngle" -> registerSteering()
        "Vehicle.registerBrakePedalStatus" -> registerBrake()
        "Vehicle.getOdometerKm" -> traveledM / 1000.0
        "Vehicle.registerTrunkOpen" -> null

        // ── 주행 중 여부(AAOS) ──
        "CarUx.current" -> {
            startWatching()
            currentRestricted()
        }

        // ── 음성 ──
        "Voice.capabilities" -> voice.capabilities()
        "Voice.speak" -> {
            voice.speak(args.optString("text"))
            null
        }
        "Voice.stop" -> {
            voice.stop()
            null
        }
        "Voice.listen" -> {
            val arr = args.optJSONArray("words") ?: JSONArray()
            val words = (0 until arr.length()).map { arr.getString(it) }
            voice.listen(words, args.optLong("timeoutMs", 6000L))
        }
        else -> throw IllegalArgumentException("알 수 없는 메서드: $method")
    }

    // ─────────────── NaviHelper 연결 ───────────────

    private var naviOrNull: NaviHelper? = null
    private var naviConnecting: Deferred<NaviHelper>? = null

    private suspend fun navi(): NaviHelper {
        naviOrNull?.let { return it }
        val pending = naviConnecting ?: scope.async { connectNavi() }.also { naviConnecting = it }
        return pending.await()
    }

    private suspend fun connectNavi(): NaviHelper {
        val done = CompletableDeferred<Throwable?>()
        val n = NaviHelper(context)
        try {
            n.initialize(onConnected = { done.complete(null) }, onFailed = { t: Throwable -> done.complete(t) })
        } catch (e: Exception) {
            done.complete(e)
        }
        val failure = withTimeoutOrNull(6000L) { done.await() } ?: if (done.isCompleted) null else IllegalStateException("NaviHelper 연결 시간 초과")
        if (failure != null) {
            naviConnecting = null
            throw IllegalStateException("NaviHelper 연결 실패: ${failure.message ?: failure.javaClass.simpleName}")
        }
        n.addListener(naviListener)
        naviOrNull = n
        startWatching()
        return n
    }

    // ─────────────── NaviHelper 콜백 → 캐시·대기 중인 호출·웹 이벤트 ───────────────

    @Volatile private var navStatus: NavigationStatus? = null
    @Volatile private var lastDest: DestinationInfo? = null
    @Volatile private var lastDestAt = 0L
    @Volatile private var lastLoc: CurrentLocationInfo? = null
    @Volatile private var lastLocAt = 0L
    @Volatile private var lastWps: List<WaypointInfo> = emptyList()
    @Volatile private var lastWpsAt = 0L
    @Volatile private var lastTbt: List<TBTInfo> = emptyList()
    @Volatile private var tripWaiter: CompletableDeferred<TripInfo>? = null
    @Volatile private var routeWaiter: CompletableDeferred<Unit>? = null
    @Volatile private var arrivedFor: String? = null
    private val destWaiters = Waiters<DestinationInfo>()
    private val locWaiters = Waiters<CurrentLocationInfo>()
    private val wpWaiters = Waiters<List<WaypointInfo>>()
    private val tbtWaiters = Waiters<List<TBTInfo>>()
    private val tripLock = Mutex()

    private val naviListener = object : NaviHelperEventListener {
        override fun onNavigationStatus(status: NavigationStatus) {
            val prev = navStatus
            navStatus = status
            emit("NaviHelper.onNavigationStatus", status.name)
            if (prev == NavigationStatus.ROUTE_DRIVE && status != NavigationStatus.ROUTE_DRIVE) {
                // 대체: 목적지 근처에서 안내가 끝나면 도착
                val d = lastDest
                if (d != null && d.remainDistance <= ARRIVE_END_M) destinationArrived(d)
                lastDest = null
                lastDestAt = now()
            }
        }

        override fun onDestinationInfo(destinationInfo: DestinationInfo) {
            lastDest = destinationInfo
            lastDestAt = now()
            destWaiters.completeAll(destinationInfo)
            emit("NaviHelper.onDestinationInfo", destJson(destinationInfo))
            if (destinationInfo.remainDistance <= ARRIVE_NEAR_M && navStatus == NavigationStatus.ROUTE_DRIVE) destinationArrived(destinationInfo)
        }

        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) {
            onLocation(currentLocationInfo)
            locWaiters.completeAll(currentLocationInfo)
        }

        override fun onWayPointInfo(waypointInfoList: List<WaypointInfo>) {
            lastWps = waypointInfoList
            lastWpsAt = now()
            wpWaiters.completeAll(waypointInfoList)
            routeWaiter?.complete(Unit)
            emit("NaviHelper.onWayPointInfo", wpsJson(waypointInfoList))
        }

        override fun onWaypointChanged(waypointChangedInfo: WaypointChangedInfo) {
            routeWaiter?.complete(Unit)
            lastWpsAt = 0L
        }

        override fun onWayPointArrived(waypointArrivedInfo: WaypointArrivedInfo) {
            // 대체: WaypointArrivedInfo 필드 미확인 → 도착한 지점은 지금 위치
            scope.launch {
                val here = runCatching { location() }.getOrNull()
                val o = JSONObject()
                    .put("name", "")
                    .put("address", "")
                    .put("poiId", "")
                    .put("remainDistance", 0)
                    .put("remainTime", 0)
                    .put("latitude", here?.optDouble("latitude") ?: JSONObject.NULL)
                    .put("longitude", here?.optDouble("longitude") ?: JSONObject.NULL)
                    .put("raw", waypointArrivedInfo.toString())
                lastWpsAt = 0L
                emit("NaviHelper.onWayPointArrived", o)
            }
        }

        override fun onTBTInfo(tbtInfoList: List<TBTInfo>) {
            lastTbt = tbtInfoList
            tbtWaiters.completeAll(tbtInfoList)
            emit("NaviHelper.onTBTInfo", tbtJson(tbtInfoList))
        }

        override fun onTripInfo(tripInfo: TripInfo) {
            tripWaiter?.complete(tripInfo)
            emit("NaviHelper.onTripInfo", tripJson(tripInfo))
        }

        override fun onRouteOptionChanged(routeOption: RouteOption) {
            emit("NaviHelper.onRouteOptionChanged", routeOption.name)
        }

        override fun onRouteCancelled() {
            lastDest = null
            lastDestAt = now()
            emit("NaviHelper.onDestinationInfo", null)
        }

        override fun onError(errorCode: NaviErrorCode) {
            Log.w(TAG, "NaviHelper 오류 ${errorCode.name}")
            emit("NaviHelper.onError", errorCode.name)
            val e = IllegalStateException("NAVI_${errorCode.name}")
            if (errorCode == NaviErrorCode.CAUSE_SEARCH_TRIP) tripWaiter?.completeExceptionally(e) else routeWaiter?.completeExceptionally(e)
        }
    }

    private fun destinationArrived(d: DestinationInfo) {
        val key = "${d.latitude},${d.longitude}"
        if (arrivedFor == key) return
        arrivedFor = key
        emit("NaviHelper.onDestinationArrived", null)
    }

    // ─────────────── 조회: 콜백으로 오는 응답을 기다린다 ───────────────

    private suspend fun navigationStatus(): String {
        navi()
        navStatus?.let { return it.name }
        // 대체: 상태 이벤트를 아직 못 받았으면 목적지 유무로 추정
        return if (destination() != null) "ROUTE_DRIVE" else "FREE_DRIVE"
    }

    private suspend fun destination(): JSONObject? {
        val n = navi()
        val status = navStatus
        if (status != null && status != NavigationStatus.ROUTE_DRIVE) return null
        if (now() - lastDestAt < FRESH_MS) return lastDest?.let { destJson(it) }
        val w = destWaiters.add()
        n.getDestinationInfo()
        // 목적지가 없으면 콜백이 오지 않을 수 있다(문서 미기재) → 시간이 지나면 '목적지 없음'
        val d = withTimeoutOrNull(QUERY_TIMEOUT_MS) { w.await() }
        destWaiters.remove(w)
        if (d == null) {
            lastDest = null
            lastDestAt = now()
        }
        return d?.let { destJson(it) }
    }

    private suspend fun location(): JSONObject {
        val n = navi()
        val cached = lastLoc
        if (cached != null && now() - lastLocAt < 700L) return locJson(cached)
        val w = locWaiters.add()
        n.getCurrentLocationInfo()
        val l = withTimeoutOrNull(QUERY_TIMEOUT_MS) { w.await() } ?: lastLoc
        locWaiters.remove(w)
        return l?.let { locJson(it) } ?: throw IllegalStateException("현재 위치를 아직 받지 못했어요")
    }

    private suspend fun waypoints(): JSONArray {
        val n = navi()
        if (now() - lastWpsAt < FRESH_MS) return wpsJson(lastWps)
        val w = wpWaiters.add()
        n.getWaypointInfo()
        // 경유지가 없으면 콜백이 오지 않을 수 있다 → 빈 목록
        val l = withTimeoutOrNull(QUERY_TIMEOUT_MS) { w.await() } ?: emptyList()
        wpWaiters.remove(w)
        lastWps = l
        lastWpsAt = now()
        return wpsJson(l)
    }

    private suspend fun tbt(): JSONArray {
        val n = navi()
        val w = tbtWaiters.add()
        n.getTBTInfo()
        val l = withTimeoutOrNull(1500L) { w.await() } ?: lastTbt
        tbtWaiters.remove(w)
        return tbtJson(l)
    }

    /** 안내를 바꾸지 않고 지점까지 거리·ETA·도착 배터리 예측(권한 NAVI_ROUTE). 응답에 요청 구분이 없어서 한 번에 하나씩. */
    private suspend fun requestTrip(a: JSONObject): JSONObject = tripLock.withLock {
        val n = navi()
        val w = CompletableDeferred<TripInfo>()
        tripWaiter = w
        try {
            n.requestTrip(
                TripRequest(
                    latitude = a.getDouble("latitude"),
                    longitude = a.getDouble("longitude"),
                    poiId = a.optString("poiId"),
                    poiName = a.optString("poiName"),
                    poiSubId = null,
                ),
            )
            val t = withTimeoutOrNull(6000L) { w.await() } ?: throw IllegalStateException("requestTrip 응답 없음")
            tripJson(t)
        } finally {
            tripWaiter = null
        }
    }

    /** 경유지 추가(권한 NAVI_ROUTE_SEARCH, 최대 2개). 반영 확인은 웹이 getWaypointInfo로 다시 조회해서 한다. */
    private suspend fun addWaypoint(a: JSONObject): Any? {
        val n = navi()
        val w = CompletableDeferred<Unit>()
        routeWaiter = w
        try {
            n.addWaypoint(
                RequestWaypointInfo(
                    latitude = a.getDouble("latitude"),
                    longitude = a.getDouble("longitude"),
                    poiName = a.optString("poiName"),
                    waypointIndex = WaypointIndex.valueOf(a.optString("waypointIndex", "FIRST")),
                    poiId = a.optString("poiId"),
                    address = a.optString("address"),
                    poiSubId = a.optString("poiSubId").ifEmpty { "0" },
                    poiProvider = a.optString("poiProvider"),
                ),
            )
            // 경로가 다시 잡히면 onWayPointInfo/onWaypointChanged가 온다(G0 확인). 오류(onError)면 여기서 실패로 끝난다.
            withTimeoutOrNull(2500L) { w.await() }
            lastWpsAt = 0L
        } finally {
            routeWaiter = null
        }
        return null
    }

    // ─────────────── 위치 누적(주행거리 대체) · 속도(주행 중 여부 대체) ───────────────

    @Volatile private var traveledM = 0.0
    @Volatile private var speedKph = 0.0
    private var prevLoc: CurrentLocationInfo? = null
    private var prevLocAt = 0L

    private fun onLocation(l: CurrentLocationInfo) {
        val t = now()
        lastLoc = l
        lastLocAt = t
        val p = prevLoc
        if (p == null) {
            prevLoc = l
            prevLocAt = t
            return
        }
        val dt = (t - prevLocAt) / 1000.0
        if (dt < 0.8) return
        val d = haversineM(p.latitude, p.longitude, l.latitude, l.longitude)
        // 순간 이동(시뮬레이션 점프)과 제자리 흔들림은 거리에서 뺀다
        if (d < 2000.0) {
            if (d > 2.0) traveledM += d
            speedKph = speedKph * 0.4 + (d / dt * 3.6) * 0.6
        }
        prevLoc = l
        prevLocAt = t
    }

    // ─────────────── 주기 작업: 위치·TBT 조회(1초), 주행 중 여부 감시(0.5초) ───────────────

    private var watching = false
    @Volatile private var restricted: Boolean? = null

    private fun startWatching() {
        if (watching) return
        watching = true
        ux.connect()
        scope.launch {
            while (isActive) {
                val n = naviOrNull
                if (n != null) {
                    runCatching { n.getCurrentLocationInfo() }
                    if (navStatus == null || navStatus == NavigationStatus.ROUTE_DRIVE) runCatching { n.getTBTInfo() }
                }
                delay(1000L)
            }
        }
        scope.launch {
            while (isActive) {
                val r = currentRestricted()
                if (r != restricted) {
                    restricted = r
                    emit("restriction", r)
                }
                delay(500L)
            }
        }
    }

    private fun currentRestricted(): Boolean = ux.requiresDistractionOptimization() ?: (speedKph > 5.0)

    // ─────────────── Vehicle ───────────────

    private var vehicleOrNull: Vehicle? = null

    private fun vehicle(): Vehicle {
        vehicleOrNull?.let { return it }
        val v = Vehicle(context)
        v.initialize()
        vehicleOrNull = v
        return v
    }

    private suspend fun capabilities(): JSONObject {
        val steer = CompletableDeferred<String>()
        try {
            vehicle().getSteeringWheel().checkSteeringWheelAngleCapabilities(
                onComplete = { cfg: CapabilityConfig, _: AreaBounds<Float> -> steer.complete(cfg.accessType.name) },
                onFailed = { _: Exception -> steer.complete("NONE") },
            )
        } catch (e: Exception) {
            steer.complete("NONE")
        }
        val soc = CompletableDeferred<String>()
        try {
            vehicle().getEvBattery().checkEvBatteryStateOfChargeCapabilities(
                onComplete = { cfg: CapabilityConfig -> soc.complete(cfg.accessType.name) },
                onFailed = { _: Exception -> soc.complete("NONE") },
            )
        } catch (e: Exception) {
            soc.complete("NONE")
        }
        return JSONObject()
            .put("steeringWheelAngle", withTimeoutOrNull(3000L) { steer.await() } ?: "NONE")
            .put("evBatteryStateOfCharge", withTimeoutOrNull(3000L) { soc.await() } ?: "NONE")
    }

    private suspend fun soc(): Int? {
        val d = CompletableDeferred<Int?>()
        try {
            vehicle().getEvBattery().getEvBatteryStateOfCharge(
                onComplete = { v: Int? -> d.complete(v) },
                onFailed = { _: Exception -> d.complete(null) },
            )
        } catch (e: Exception) {
            d.complete(null)
        }
        return withTimeoutOrNull(3000L) { d.await() }
    }

    private val registered = HashSet<String>()

    /** 같은 리스너를 두 번 등록하지 않는다(웹이 다시 시작해도) */
    private fun once(key: String, block: () -> Unit): Any? {
        if (!registered.add(key)) return null
        try {
            block()
        } catch (e: Exception) {
            registered.remove(key)
            throw e
        }
        return null
    }

    /** 줄(tag)마다 좌석별 착석 — 한 곳이라도 앉아 있으면 그 줄은 true */
    private val seatState = HashMap<String, HashMap<String, Boolean>>()
    private val seatListeners = ArrayList<Pair<SeatValue, SeatOccupancyListener>>()
    private var socListener: EvBatteryStateOfChargeListener? = null
    private var turnListener: TurnSignalStateListener? = null
    private var steerListener: SteeringWheelAngleListener? = null
    private var brakeListener: BrakePedalStatusListener? = null

    /**
     * 좌석 착석: 줄(tag)마다 따로 등록한다(row2: ROW_2_LEFT·CENTER·RIGHT, row3: ROW_3_LEFT·RIGHT).
     * 결과는 실제로 등록한 SeatValue 이름 목록. 이 SDK 버전에 없는 이름은 건너뛴다(TODO(G0): ROW_3_CENTER 유무 확인).
     * 이벤트: Vehicle.onSeatOccupancyUpdated {tag, occupied}
     */
    private fun registerSeats(area: JSONArray?, tag: String): Any? {
        if (!registered.add("seat:$tag")) return JSONObject().put("tag", tag).put("registered", JSONArray())
        try {
            val seat = vehicle().getSeat()
            val names = (0 until (area?.length() ?: 0)).map { area!!.getString(it) }.ifEmpty { listOf("ROW_2_LEFT", "ROW_2_CENTER", "ROW_2_RIGHT") }
            val done = JSONArray()
            for (name in names) {
                val sv = runCatching { SeatValue.valueOf(name) }.getOrNull() ?: continue
                val l = object : SeatOccupancyListener {
                    override fun onSeatOccupancyUpdated(occupancy: Boolean?) {
                        if (occupancy == null) return
                        val any = synchronized(seatState) {
                            val row = seatState.getOrPut(tag) { HashMap() }
                            row[name] = occupancy
                            row.values.any { it }
                        }
                        emit("Vehicle.onSeatOccupancyUpdated", JSONObject().put("tag", tag).put("occupied", any))
                    }
                }
                seat.registerSeatOccupancy(SeatArea(sv), l)
                seatListeners.add(sv to l)
                done.put(name)
            }
            return JSONObject().put("tag", tag).put("registered", done)
        } catch (e: Exception) {
            registered.remove("seat:$tag")
            throw e
        }
    }

    private fun registerSoc(): Any? = once("soc") {
        val l = object : EvBatteryStateOfChargeListener {
            override fun onEvBatteryStateOfChargeUpdated(value: Int?) {
                emit("Vehicle.onEvBatteryStateOfChargeUpdated", value)
            }
        }
        vehicle().getEvBattery().registerEvBatteryStateOfCharge(l)
        socListener = l
    }

    private fun registerTurnSignal(): Any? = once("turn") {
        val l = object : TurnSignalStateListener {
            override fun onTurnSignalStateUpdated(state: TurnSignalValue?) {
                emit("Vehicle.onTurnSignalStateUpdated", state?.name)
            }
        }
        vehicle().getTurnSignal().registerTurnSignalState(l)
        turnListener = l
    }

    private var lastSteerAt = 0L
    private var lastSteer = 0f

    private fun registerSteering(): Any? = once("steer") {
        val l = object : SteeringWheelAngleListener {
            override fun onSteeringWheelAngleUpdated(angle: Float?) {
                if (angle == null) return
                // 갱신 주기를 모른다(G0) → 0.15초에 한 번, 또는 2° 넘게 바뀔 때만 웹으로
                val t = now()
                if (t - lastSteerAt < 150L && abs(angle - lastSteer) < 2f) return
                lastSteerAt = t
                lastSteer = angle
                emit("Vehicle.onSteeringWheelAngleUpdated", angle.toDouble())
            }
        }
        vehicle().getSteeringWheel().registerSteeringWheelAngle(l)
        steerListener = l
    }

    private fun registerBrake(): Any? = once("brake") {
        val l = object : BrakePedalStatusListener {
            override fun onBrakePedalStatusUpdated(status: Boolean?) {
                emit("Vehicle.onBrakePedalStatusUpdated", status)
            }
        }
        vehicle().getBrake().registerBrakePedalStatus(l)
        brakeListener = l
    }

    override fun release() {
        scope.cancel()
        val v = vehicleOrNull
        if (v != null) {
            runCatching { seatListeners.forEach { (sv, l) -> v.getSeat().unregisterSeatOccupancy(SeatArea(sv), l) } }
            runCatching { socListener?.let { v.getEvBattery().unregisterEvBatteryStateOfCharge(it) } }
            runCatching { turnListener?.let { v.getTurnSignal().unregisterTurnSignalState(it) } }
            runCatching { steerListener?.let { v.getSteeringWheel().unregisterSteeringWheelAngle(it) } }
            runCatching { brakeListener?.let { v.getBrake().unregisterBrakePedalStatus(it) } }
            runCatching { v.release() }
        }
        runCatching { naviOrNull?.removeListener(naviListener) }
        runCatching { naviOrNull?.release() }
        naviOrNull = null
        vehicleOrNull = null
        ux.release()
        voice.release()
    }

    // ─────────────── JSON (웹 ports.ts 모양) ───────────────

    private fun destJson(d: DestinationInfo): JSONObject = JSONObject()
        .put("latitude", d.latitude)
        .put("longitude", d.longitude)
        .put("name", d.name)
        .put("address", d.address)
        .put("remainDistance", d.remainDistance)
        .put("remainTime", d.remainTime)

    private fun locJson(l: CurrentLocationInfo): JSONObject = JSONObject()
        .put("latitude", l.latitude)
        .put("longitude", l.longitude)
        .put("heading", l.heading)
        .put("address", l.address)

    private fun wpsJson(list: List<WaypointInfo>): JSONArray {
        val arr = JSONArray()
        for (w in list) {
            arr.put(
                JSONObject()
                    .put("name", w.name)
                    .put("address", w.address)
                    .put("latitude", w.latitude)
                    .put("longitude", w.longitude)
                    .put("remainDistance", w.remainDistance)
                    .put("remainTime", w.remainTime)
                    .put("poiId", w.poiId),
            )
        }
        return arr
    }

    private fun tbtJson(list: List<TBTInfo>): JSONArray {
        val arr = JSONArray()
        for (t in list) arr.put(JSONObject().put("type", t.type.name).put("distance", t.distance).put("description", t.description))
        return arr
    }

    private fun tripJson(t: TripInfo): JSONObject = JSONObject()
        .put("distance", t.distance)
        .put("eta", t.eta)
        .put("estimatedSocAtDest", t.estimatedSocAtDest)
        .put("energyConsumption", t.energyConsumption)
        .put("summary", "${t.summary}")

    private fun now(): Long = System.currentTimeMillis()

    companion object {
        private const val TAG = "PleosBackend"
        private const val FRESH_MS = 900L
        private const val QUERY_TIMEOUT_MS = 2500L
        /** 안내가 끝났을 때 이 거리 안이었으면 도착 */
        private const val ARRIVE_END_M = 300
        /** 안내 중 남은 거리가 이보다 작으면 도착 */
        private const val ARRIVE_NEAR_M = 30

        private fun haversineM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val r = 6371000.0
            val dLat = Math.toRadians(lat2 - lat1)
            val dLng = Math.toRadians(lng2 - lng1)
            val a = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
            return 2 * r * asin(sqrt(a))
        }
    }
}

/** 콜백 하나로 응답이 오는 조회들 — 기다리는 호출을 한꺼번에 깨운다 */
private class Waiters<T> {
    private val list = ArrayList<CompletableDeferred<T>>()

    fun add(): CompletableDeferred<T> {
        val d = CompletableDeferred<T>()
        synchronized(list) { list.add(d) }
        return d
    }

    fun remove(d: CompletableDeferred<T>) {
        synchronized(list) { list.remove(d) }
    }

    fun completeAll(v: T) {
        val all = synchronized(list) {
            val copy = ArrayList(list)
            list.clear()
            copy
        }
        for (d in all) d.complete(v)
    }
}

/**
 * 주행 중 여부 — Android Automotive OS 표준 API(android.car). Pleos SDK가 아니다.
 * 못 쓰면 null → PleosBackend가 위치 변화로 잰 속도로 대신 판단한다.
 */
class DrivingRestriction(private val context: Context) {
    private var car: android.car.Car? = null
    private var manager: android.car.drivingstate.CarUxRestrictionsManager? = null

    fun connect() {
        if (car != null) return
        try {
            val c = android.car.Car.createCar(context) ?: return
            car = c
            manager = c.getCarManager(android.car.Car.CAR_UX_RESTRICTION_SERVICE) as? android.car.drivingstate.CarUxRestrictionsManager
        } catch (e: Throwable) {
            Log.w("DrivingRestriction", "android.car 사용 불가: ${e.javaClass.simpleName}")
        }
    }

    fun requiresDistractionOptimization(): Boolean? =
        try {
            manager?.currentCarUxRestrictions?.isRequiresDistractionOptimization
        } catch (e: Throwable) {
            null
        }

    fun release() {
        try {
            car?.disconnect()
        } catch (_: Throwable) {
        }
        car = null
        manager = null
    }
}
