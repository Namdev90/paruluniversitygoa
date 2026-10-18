package `in`.navrang.gate

import android.app.Application
import android.net.Uri
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.json.JSONArray
import org.json.JSONObject

class GateViewModel @JvmOverloads constructor(app: Application, startRuntime: Boolean = true) :
    AndroidViewModel(app), GateRuntime.Listener, GateUpdater.Listener {
    private val mutable = MutableStateFlow(GateState())
    val state: StateFlow<GateState> = mutable.asStateFlow()
    var repository: GateRepository? = null
        private set

    private var operation: Job? = null
    private var actionSequence = 0L
    private var signingOut = false
    private var pendingRevocationToken: String? = null
    private var identitySequence = 0L
    private var deskJob: Job? = null
    private var localJob: Job? = null
    private var localAgain = false
    private var deskSequence = 0L
    private var reportSequence = 0L
    private var sessionScope = ""
    private var epoch = 0L
    private var resumed = false
    private var runtimeResumed = false
    private val outcomes = ScanOutcomes()
    private var saveRequest: Pair<String, JSONObject>? = null
    private var importRows: JSONArray? = null
    private var export: ExportDocument? = null
    private var exportJob: Job? = null
    private val prefs = app.getSharedPreferences("navrang-native-appearance", 0)

    init {
        mutable.update {
            it.copy(
                appearance =
                    Appearance(
                        prefs.getString("mode", "system") ?: "system",
                        prefs.getBoolean("dynamic", true),
                        prefs.getBoolean("reduced", false),
                    )
            )
        }
        if (startRuntime)
            viewModelScope.launch {
                try {
                    val repo = GateRepository.open(app)
                    repository = repo
                    repo.runtime.add(this@GateViewModel)
                    withContext(Dispatchers.IO) {
                        if (!BuildConfig.DEBUG) GateUpdater.init(app)
                        GateFeedback.init(app)
                    }
                    GateUpdater.add(this@GateViewModel)
                    refreshIdentity()
                    mutable.update {
                        it.copy(
                            ready = true,
                            intro = it.profile == null && !prefs.getBoolean("introSeen", false),
                        )
                    }
                    applyForeground()
                    if (resumed) withContext(Dispatchers.IO) { GateUpdater.publish(app) }
                    loadLocal()
                } catch (_: Exception) {
                    mutable.update {
                        it.copy(
                            ready = true,
                            message =
                                "Could not open existing app data. Keep the app data and retry.",
                        )
                    }
                }
            }
        if (startRuntime)
            viewModelScope.launch {
                while (isActive) {
                    delay(100)
                    if (resumed) {
                        if (mutable.value.profile?.expired == true) {
                            signOut()
                            message(
                                "Account access expired. Sign in again after administrator renewal."
                            )
                        }
                        outcomes.tick(SystemClock.elapsedRealtime())
                        paintOutcomes()
                    }
                }
            }
    }

    private fun repo() = repository ?: throw IllegalStateException("App is starting.")

    // Runtime resume/pause only update a synchronized counter. Apply them on the
    // main thread in lifecycle order; slower updater work remains on IO.
    private fun applyForeground() {
        val runtime = repository?.runtime ?: return
        if (runtimeResumed == resumed) return
        if (resumed) runtime.resume() else runtime.pause()
        runtimeResumed = resumed
    }

    fun foreground(active: Boolean) {
        if (resumed == active) return
        resumed = active
        applyForeground()
        GateUpdater.scanActive = active && mutable.value.destination == Destination.Scanner
        if (active)
            viewModelScope.launch(Dispatchers.IO) {
                GateUpdater.publish(getApplication())
                if (!BuildConfig.DEBUG && GateUpdater.automatic(getApplication()))
                    GateUpdater.check(getApplication(), false, false)
            }
    }

    private fun permitted(d: Destination, p: Profile?) =
        when (d) {
            Destination.Checker,
            Destination.Scanner -> p?.canScan == true
            Destination.Entries,
            Destination.Students,
            Destination.Staff,
            Destination.Summary -> p?.admin == true
            Destination.Desk -> p?.canDesk == true
            Destination.Reports -> p?.canReport == true
            else -> true
        }

    private fun home(p: Profile?) =
        when {
            p?.admin == true -> Destination.Students
            p?.canScan == true -> Destination.Checker
            p?.canDesk == true -> Destination.Desk
            p?.canReport == true -> Destination.Reports
            else -> Destination.Station
        }

    private suspend fun refreshIdentity() {
        if (signingOut) return
        val request = ++identitySequence
        val generation = repository?.runtime?.sessions?.generation()
        val p = repository?.profile()
        if (
            signingOut ||
                request != identitySequence ||
                generation != repository?.runtime?.sessions?.generation()
        )
            return
        val scope = p?.scope ?: ""
        if (scope != sessionScope) {
            epoch++
            sessionScope = scope
            deskJob?.cancel()
            exportJob?.cancel()
            export?.clear()
            export = null
            saveRequest = null
            importRows = null
            outcomes.clear()
            val old = mutable.value
            mutable.value =
                GateState(
                    ready = old.ready,
                    profile = p,
                    appearance = old.appearance,
                    update = old.update,
                    destination = home(p),
                    busy = old.busy && !old.exportPreparing,
                    intro = old.intro,
                )
        } else mutable.update { it.copy(profile = p) }
    }

    override fun event(event: JSONObject) {
        val type = event.text("type")
        val data = event.optJSONObject("data") ?: JSONObject()
        viewModelScope.launch {
            if (signingOut) return@launch
            when (type) {
                "auth",
                "profile" -> {
                    refreshIdentity()
                    loadLocal()
                }
                "sync" -> loadLocal()
                "connection" -> mutable.update { it.copy(online = false) }
                "result" -> {
                    if (mutable.value.profile?.canScan == true) {
                        val result = ScanResult.from(data)
                        outcomes.receive(result, SystemClock.elapsedRealtime())
                        paintOutcomes()
                        if (!result.pending)
                            GateFeedback.play(
                                getApplication(),
                                when (result.code) {
                                    "admitted" -> "success"
                                    "duplicate" -> "duplicate"
                                    "not_found",
                                    "invalid" -> "invalid"
                                    else -> "issue"
                                },
                            )
                        loadLocal()
                    }
                }
            }
        }
    }

    override fun updated(state: JSONObject) {
        mutable.update { it.copy(update = state.fields()) }
    }

    private fun paintOutcomes() {
        val s = mutable.value
        if (s.result != outcomes.current || s.held != outcomes.held) {
            if (s.held == null && outcomes.held?.pending == true)
                GateFeedback.play(getApplication(), "pending")
            mutable.update { it.copy(result = outcomes.current, held = outcomes.held) }
        }
    }

    fun acknowledge() {
        outcomes.acknowledge(SystemClock.elapsedRealtime())
        paintOutcomes()
    }

    private fun loadLocal() {
        if (localJob?.isActive == true) {
            localAgain = true
            return
        }
        val expected = epoch
        localJob = viewModelScope.launch {
            val repo = repository ?: return@launch
            try {
                val admin = mutable.value.profile?.admin == true
                val snapshot =
                    withContext(Dispatchers.Default) {
                        val data = repo.local()
                        GateState(
                            online = repo.runtime.online(),
                            stats = data.optJSONObject("stats")?.fields() ?: emptyMap(),
                            pending = data.optInt("pending"),
                            tickets =
                                if (admin)
                                    data.optJSONArray("records")?.objects()?.map(Ticket::from)
                                        ?: emptyList()
                                else emptyList(),
                            entries =
                                if (admin)
                                    data.optJSONArray("allEntries")?.objects()?.map(Receipt::from)
                                        ?: emptyList()
                                else emptyList(),
                            staff =
                                if (admin)
                                    data.optJSONArray("checkers")?.objects()?.map(Staff::from)
                                        ?: emptyList()
                                else emptyList(),
                        )
                    }
                if (expected != epoch) return@launch
                mutable.update { s ->
                    s.copy(
                        online = snapshot.online,
                        stats = snapshot.stats,
                        pending = snapshot.pending,
                        tickets = snapshot.tickets,
                        entries = snapshot.entries,
                        staff = snapshot.staff,
                    )
                }
            } catch (_: Exception) {
                if (expected == epoch) message("Unable to read temporary data. Refresh to retry.")
            } finally {
                localJob = null
                if (localAgain) {
                    localAgain = false
                    loadLocal()
                }
            }
        }
    }

    fun navigate(next: Destination) {
        if (!permitted(next, mutable.value.profile)) return
        if (mutable.value.pendingSave && next != Destination.Desk) {
            message("This Help Desk save is unconfirmed. Retry the same save first.")
            return
        }
        if (next != Destination.Scanner) GateUpdater.scanActive = false
        mutable.update {
            it.copy(
                destination = next,
                modal = "",
                selectedTicket = null,
                selectedStaff = null,
                selectedCase = null,
                message = "",
            )
        }
        if (next == Destination.Desk) loadDesk()
        if (next == Destination.Reports) loadReports()
    }

    fun message(message: String) {
        mutable.update { it.copy(message = message) }
    }

    fun clearMessage() {
        message("")
    }

    private fun runAction(work: suspend (Long) -> Unit) {
        if (signingOut || operation?.isActive == true) return
        val sequence = ++actionSequence
        val expected = epoch
        mutable.update { it.copy(busy = true, message = "") }
        operation = viewModelScope.launch {
            try {
                work(expected)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (expected == epoch)
                    message(
                        if (e is GateFailure || e is IllegalArgumentException || e is StaleSession)
                            e.message ?: "Request failed."
                        else if (mutable.value.pendingSave)
                            "Save is unconfirmed. Keep this app open and retry the same save."
                        else "Connection interrupted. Retry safely when connected."
                    )
            } finally {
                if (sequence == actionSequence && !signingOut)
                    mutable.update { it.copy(busy = false) }
            }
        }
    }

    fun login(action: String, payload: JSONObject) = runAction {
        repo().login(action, payload)
        refreshIdentity()
        loadLocal()
        if (mutable.value.profile?.canReport == true) loadReports()
    }

    fun signOut() {
        if (signingOut) return
        signingOut = true
        actionSequence++
        operation?.cancel()
        operation = null
        deskJob?.cancel()
        localJob?.cancel()
        localAgain = false
        epoch++
        saveRequest = null
        importRows = null
        exportJob?.cancel()
        export?.clear()
        export = null
        outcomes.clear()
        sessionScope = ""
        GateUpdater.scanActive = false
        val s = mutable.value
        mutable.value =
            GateState(
                ready = true,
                busy = true,
                signOutPending = true,
                appearance = s.appearance,
                update = s.update,
            )
        viewModelScope.launch {
            var oldToken: String? = null
            try {
                withContext(NonCancellable + Dispatchers.IO) {
                    // Retain the first token in RAM across a failed durable clear.
                    // A retry must still revoke that original server session.
                    if (pendingRevocationToken == null)
                        pendingRevocationToken = repo().runtime.sessions.read()?.text("token")
                    repo().clearSession()
                    oldToken = pendingRevocationToken
                    pendingRevocationToken = null
                    getApplication<Application>()
                        .getSharedPreferences("navrang-pkce", 0)
                        .edit()
                        .clear()
                        .commit()
                }
                mutable.update { it.copy(signOutPending = false) }
                try {
                    androidx.credentials.CredentialManager.create(getApplication())
                        .clearCredentialState(androidx.credentials.ClearCredentialStateRequest())
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    message(
                        "Signed out locally. Google account selection may need to be reset in Android settings."
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                message("Sign-out could not be saved. Retry before closing the app.")
            } finally {
                signingOut = false
                mutable.update { it.copy(busy = false) }
            }
            oldToken?.let { repository?.revokeSession(it) }
        }
    }

    suspend fun completeGoogle(token: String, nonce: String, generation: Long) {
        repo().googleIdToken(token, nonce, generation)
        refreshIdentity()
        loadLocal()
    }

    suspend fun beginGoogle(): Long {
        check(!signingOut && operation?.isActive != true) { "Sign-in is already changing." }
        return repo().beginGoogle()
    }

    fun oauth(code: String, verifier: String, generation: Long) = runAction {
        repo().oauth(code, verifier, generation)
        refreshIdentity()
        loadLocal()
    }

    fun refresh() = runAction {
        repo().call("me")
        refreshIdentity()
        repo().refresh()
        loadLocal()
        when (mutable.value.destination) {
            Destination.Reports -> loadReports()
            Destination.Desk -> loadDesk()
            else -> {}
        }
    }

    fun saveName(name: String) = runAction { expected ->
        repo().call("checker-profile", json("name" to name.trim()))
        repo().call("me")
        if (expected == epoch) {
            closeModal()
            refreshIdentity()
        }
    }

    fun station(station: String) = runAction { expected ->
        val p = mutable.value.profile ?: return@runAction
        if (p.admin) {
            navigate(if (station == "checker") Destination.Checker else Destination.Desk)
            return@runAction
        }
        if (p.station.isNotBlank()) {
            require(p.station == station) {
                "Only the administrator can change your saved station."
            }
        } else repo().call("staff-request", json("station" to station))
        repo().call("me")
        refreshIdentity()
        if (expected == epoch)
            message("Station request saved. Access is decided by the administrator.")
    }

    fun requestFaculty() = runAction {
        repo().call("reports-request")
        repo().call("me")
        refreshIdentity()
        message("Faculty access requested. Administrator approval is required.")
    }

    fun submit(raw: String) {
        if (mutable.value.held != null || mutable.value.profile?.canScan != true) return
        val id = raw.trim().uppercase()
        if (!Regex("[A-Z0-9]{8}").matches(id)) {
            outcomes.receive(
                ScanResult("", "invalid", "", "Use the exact eight-character ticket ID."),
                SystemClock.elapsedRealtime(),
            )
            paintOutcomes()
            return
        }
        viewModelScope.launch { repo().submit(id) }
    }

    fun scanned(raw: String) {
        val id = GateQr.ticket(raw)
        if (id == null) {
            outcomes.receive(
                ScanResult(
                    "",
                    "invalid",
                    "",
                    "This QR does not contain a valid Navrang event ticket.",
                ),
                SystemClock.elapsedRealtime(),
            )
            paintOutcomes()
        } else submit(id)
    }

    fun studentSearch(q: String) {
        mutable.update { it.copy(studentQuery = q.take(128), studentPage = PageState()) }
    }

    fun studentFilter(filter: String) {
        mutable.update { it.copy(studentFilter = filter, studentPage = PageState()) }
    }

    fun entrySearch(q: String) {
        mutable.update { it.copy(entryQuery = q.take(128), entryPage = PageState()) }
    }

    fun page(students: Boolean, delta: Int, total: Int) {
        mutable.update {
            if (students)
                it.copy(
                    studentPage =
                        it.studentPage.copy(index = it.studentPage.index + delta).bounded(total)
                )
            else
                it.copy(
                    entryPage = it.entryPage.copy(index = it.entryPage.index + delta).bounded(total)
                )
        }
    }

    fun inspectTicket(ticket: Ticket) {
        if (mutable.value.profile?.admin != true) return
        mutable.update { it.copy(selectedTicket = ticket, modal = "studentDetails") }
    }

    fun openTicket(ticket: Ticket?) {
        if (mutable.value.profile?.admin != true) return
        mutable.update { it.copy(selectedTicket = ticket, modal = "ticket") }
    }

    fun openStaff(staff: Staff?) {
        if (mutable.value.profile?.admin != true) return
        mutable.update {
            it.copy(
                selectedStaff = staff,
                modal = if (staff == null) "newStaff" else "staff",
                staffCode = "",
            )
        }
    }

    fun openModal(name: String) {
        mutable.update { it.copy(modal = name) }
    }

    fun closeModal() {
        if (mutable.value.modal == "import") importRows = null
        mutable.update {
            it.copy(
                modal = "",
                selectedTicket = null,
                selectedStaff = null,
                selectedCase = null,
                staffCode = "",
            )
        }
    }

    fun saveTicket(ticket: Ticket) = runAction { expected ->
        require(mutable.value.profile?.admin == true)
        require(Regex("[A-Z0-9]{8}").matches(ticket.id)) {
            "Enter an exact eight-character ticket ID."
        }
        val row = ticket.registrationPayload()
        repo()
            .call(
                "upsert",
                json(
                    "eventId" to "O9KL3",
                    "source" to "Admin manual update",
                    "records" to JSONArray().put(row),
                ),
            )
        if (expected == epoch) {
            closeModal()
            repo().refresh()
            message("Registration saved on the server.")
        }
    }

    fun saveStaff(name: String, active: Boolean, role: String) = runAction { expected ->
        require(mutable.value.profile?.admin == true)
        val staff = mutable.value.selectedStaff
        val payload =
            json(
                "name" to name.trim(),
                "scanner" to (role in listOf("checker", "both")),
                "helpdesk" to (role in listOf("helpdesk", "both")),
            )
        if (staff != null) payload.put("id", staff.id).put("active", active)
        val r = repo().call(if (staff == null) "staff-create" else "staff-update", payload)
        if (expected == epoch) {
            repo().refresh()
            if (staff == null) mutable.update { it.copy(staffCode = r.text("code")) }
            else closeModal()
        }
    }

    fun changePassword(password: String) = runAction { expected ->
        require(password.length >= 12) { "Use at least 12 characters." }
        repo().call("admin-password", json("password" to password))
        if (expected == epoch) {
            closeModal()
            message("Password changed. Other administrator sessions were signed out.")
        }
    }

    fun draft(value: DeskDetails) {
        if (!mutable.value.pendingSave) mutable.update { it.copy(draft = value) }
    }

    fun newDesk() {
        if (mutable.value.pendingSave) return
        mutable.update { it.copy(draft = DeskDetails(), editing = null, modal = "deskForm") }
    }

    fun openCase(row: DeskCase) {
        mutable.update { it.copy(selectedCase = row, modal = "deskReview") }
    }

    fun editCase(row: DeskCase) {
        if (mutable.value.profile?.admin != true || row.status != "pending") return
        mutable.update { it.copy(editing = row, draft = row.details, modal = "deskForm") }
    }

    fun saveDesk() = runAction { expected ->
        require(mutable.value.profile?.canDesk == true)
        if (saveRequest == null) {
            val details = mutable.value.draft.payload()
            val edit = mutable.value.editing
            saveRequest =
                if (edit == null)
                    "helpdesk-save" to
                        json("requestId" to UUID.randomUUID().toString(), "details" to details)
                else
                    "helpdesk-edit" to
                        json("id" to edit.id, "version" to edit.version, "details" to details)
        }
        mutable.update { it.copy(pendingSave = true) }
        try {
            val request = saveRequest!!
            val r = repo().call(request.first, request.second)
            if (expected == epoch) {
                saveRequest = null
                mutable.update {
                    it.copy(
                        pendingSave = false,
                        draft = DeskDetails(),
                        editing = null,
                        modal = "",
                        message =
                            "Saved on server · ${r.getJSONObject("registration").text("ticket_id")} · pending verification",
                    )
                }
                loadDesk()
            }
        } catch (e: Exception) {
            if (expected == epoch) {
                if (e is GateFailure && e.status in 400..499) {
                    saveRequest = null
                    mutable.update { it.copy(pendingSave = false) }
                } else message("Save is unconfirmed. Keep this app open and retry the same save.")
            }
            throw e
        }
    }

    fun deskSearch(value: String) {
        mutable.update { it.copy(deskQuery = value.take(128), deskPage = 0) }
        loadDesk(debounce = true)
    }

    fun deskFilter(value: String) {
        mutable.update { it.copy(deskFilter = value, deskPage = 0) }
        loadDesk()
    }

    fun deskPage(delta: Int) {
        val s = mutable.value
        val page = (s.deskPage + delta).coerceIn(0, (s.deskTotal - 1).coerceAtLeast(0) / 8)
        mutable.update { it.copy(deskPage = page) }
        loadDesk()
    }

    fun loadDesk(debounce: Boolean = false) {
        deskJob?.cancel()
        val seq = ++deskSequence
        val expected = epoch
        val q = mutable.value
        deskJob = viewModelScope.launch {
            if (debounce) delay(250)
            if (q.profile?.canDesk != true) return@launch
            mutable.update { it.copy(deskLoading = true, deskError = "") }
            try {
                val r =
                    repo()
                        .call(
                            "helpdesk-list",
                            json(
                                "offset" to q.deskPage * 8,
                                "limit" to 8,
                                "search" to q.deskQuery.trim(),
                                "status" to q.deskFilter,
                            ),
                        )
                if (expected != epoch) return@launch
                val total = r.optInt("total")
                val last = (total - 1).coerceAtLeast(0) / 8
                if (q.deskPage > last) {
                    mutable.update { it.copy(deskPage = last) }
                    loadDesk()
                    return@launch
                }
                mutable.update {
                    it.copy(
                        deskRows = r.getJSONArray("records").objects().map(DeskCase::from),
                        deskTotal = total,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                if (expected == epoch)
                    mutable.update {
                        it.copy(deskError = "Could not load cases. Refresh to retry.")
                    }
            } finally {
                if (expected == epoch && seq == deskSequence)
                    mutable.update { it.copy(deskLoading = false) }
            }
        }
    }

    fun reviewCase(approve: Boolean, verified: Boolean) = runAction { expected ->
        require(mutable.value.profile?.admin == true)
        val row = mutable.value.selectedCase ?: return@runAction
        require(!approve || verified) { "Verify the same person and payment before approving." }
        repo()
            .call(
                "helpdesk-review",
                json(
                    "id" to row.id,
                    "version" to row.version,
                    "status" to if (approve) "approved" else "rejected",
                    "confirmExisting" to verified,
                    "confirmPayment" to verified,
                ),
            )
        if (expected == epoch) {
            closeModal()
            loadDesk()
            repo().refresh()
        }
    }

    fun reportKind(kind: String) {
        if (kind in ReportEncoder.kinds) mutable.update { it.copy(reportKind = kind) }
    }

    fun loadReports() {
        if (mutable.value.profile?.canReport != true) return
        val expected = epoch
        val seq = ++reportSequence
        viewModelScope.launch {
            try {
                val r = repo().call("reports-summary")
                if (expected != epoch || seq != reportSequence) return@launch
                mutable.update {
                    it.copy(reportSummary = r.getJSONObject("stats").fields(), reportError = "")
                }
                if (mutable.value.profile?.admin == true)
                    try {
                        val members = repo().call("reports-members")
                        if (expected == epoch && seq == reportSequence)
                            mutable.update {
                                it.copy(
                                    faculty =
                                        members.getJSONArray("members").objects().map(Faculty::from)
                                )
                            }
                    } catch (_: Exception) {
                        if (expected == epoch)
                            message(
                                "Faculty management is unavailable. Report downloads remain available."
                            )
                    }
            } catch (_: Exception) {
                if (expected == epoch && seq == reportSequence)
                    mutable.update {
                        it.copy(reportError = "Reports could not load. Refresh to retry.")
                    }
            }
        }
    }

    fun grantFaculty(member: Faculty) = runAction { expected ->
        require(mutable.value.profile?.admin == true)
        repo().call("reports-grant", json("checkerId" to member.id, "enabled" to !member.enabled))
        if (expected == epoch) loadReports()
    }

    fun readImport(uri: Uri?) {
        if (uri == null) return
        runAction { expected ->
            require(mutable.value.profile?.admin == true)
            val rows =
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openInputStream(uri).use { input
                        ->
                        requireNotNull(input)
                        val bytes = RegistrationImport.readBounded(input)
                        try {
                            RegistrationImport.parse(bytes)
                        } finally {
                            bytes.fill(0)
                        }
                    }
                }
            if (expected == epoch) {
                importRows = rows
                mutable.update { it.copy(importCount = rows.length(), modal = "import") }
            }
        }
    }

    fun confirmImport() = runAction { expected ->
        require(mutable.value.profile?.admin == true)
        val rows = importRows ?: return@runAction
        repo()
            .call(
                "import",
                json(
                    "eventId" to "O9KL3",
                    "source" to "Administrator document import",
                    "records" to rows,
                ),
            )
        if (expected == epoch) {
            importRows = null
            closeModal()
            repo().refresh()
            message("Registration list replaced on the server. Existing admissions remain intact.")
        }
    }

    fun appearance(value: Appearance) {
        mutable.update { it.copy(appearance = value) }
        prefs
            .edit()
            .putString("mode", value.mode)
            .putBoolean("dynamic", value.dynamic)
            .putBoolean("reduced", value.reducedMotion)
            .apply()
    }

    fun endIntro() {
        GateFeedback.play(getApplication(), "stop-intro")
        prefs.edit().putBoolean("introSeen", true).apply()
        mutable.update { it.copy(intro = false) }
    }

    fun prepareExport(format: String, contacts: Boolean = false) {
        if (exportJob?.isActive == true || export != null) return
        val expected = epoch
        val sequence = ++actionSequence
        val generation = repo().runtime.sessions.generation()
        val kind = mutable.value.reportKind
        mutable.update { it.copy(busy = true, exportPreparing = true) }
        exportJob = viewModelScope.launch {
            try {
                repo().call("me")
                if (expected != epoch || !repo().mayExport(generation, contacts))
                    throw StaleSession()
                val result =
                    if (contacts) {
                        val r = repo().call("helpdesk-export")
                        ExportDocument(
                            r.text("filename"),
                            "text/csv",
                            r.text("csv").toByteArray(),
                            generation,
                            true,
                        )
                    } else if (format == "pdf") {
                        val r = repo().call("reports-summary")
                        withContext(Dispatchers.Default) {
                            ReportEncoder.summary(r.getJSONObject("stats"), generation)
                        }
                    } else {
                        val r = repo().call("reports-export", json("kind" to kind))
                        withContext(Dispatchers.Default) {
                            ReportEncoder.dataset(r, kind, format, generation)
                        }
                    }
                if (expected != epoch || !repo().mayExport(generation, contacts)) {
                    result.clear()
                    throw StaleSession()
                }
                export = result
                mutable.update { it.copy(exportReady = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                if (expected == epoch)
                    message("Export could not be prepared. Refresh access and retry.")
            } finally {
                if (sequence == actionSequence)
                    mutable.update { it.copy(busy = false, exportPreparing = false) }
            }
        }
    }

    fun exportInfo(): Pair<String, String>? = export?.let { it.filename to it.mime }

    fun exportPickerOpened() {
        mutable.update { it.copy(exportReady = false) }
    }

    fun cancelExport() {
        exportJob?.cancel()
        export?.clear()
        export = null
        mutable.update { it.copy(exportReady = false, busy = false, exportPreparing = false) }
    }

    fun saveExport(uri: Uri?) {
        val doc = export
        export = null
        mutable.update { it.copy(exportReady = false) }
        if (uri == null || doc == null) {
            doc?.clear()
            return
        }
        val expected = epoch
        viewModelScope.launch(Dispatchers.IO) {
            try {
                repo().call("me")
                if (!repo().mayExport(doc.generation, doc.contacts)) throw StaleSession()
                getApplication<Application>().contentResolver.openOutputStream(uri, "wt").use { out
                    ->
                    requireNotNull(out)
                    for (at in doc.bytes.indices step 16384) {
                        if (!repo().mayExport(doc.generation, doc.contacts)) throw StaleSession()
                        out.write(doc.bytes, at, minOf(16384, doc.bytes.size - at))
                    }
                }
                if (expected == epoch)
                    message("Saved. External copies remain accessible at the location you chose.")
            } catch (_: Exception) {
                if (expected == epoch)
                    message(
                        "Save did not finish. A partial document may exist; remove it and retry."
                    )
            } finally {
                doc.clear()
            }
        }
    }

    override fun onCleared() {
        repository?.runtime?.remove(this)
        GateUpdater.remove(this)
        resumed = false
        applyForeground()
        GateUpdater.scanActive = false
        export?.clear()
        saveRequest = null
        importRows = null
        outcomes.clear()
    }
}
